import { useState } from 'react';
import { FileCode, Upload } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Seg, Stat, downloadBlob, fmtBytes, readFileAsDataURL } from './shared';

const decodeDataUri = (input) => {
  const text = String(input || '').trim();
  const match = /^data:([^;,]*)(;[^,]*)?,(.*)$/s.exec(text);
  if (!match) return null;
  const [, mime, params = '', payload] = match;
  const isBase64 = params.includes('base64');
  try {
    if (isBase64) {
      const binary = atob(payload.replace(/\s/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { mime: mime || 'application/octet-stream', bytes, raw: null };
    }
    const decoded = decodeURIComponent(payload);
    return { mime: mime || 'text/plain', bytes: new TextEncoder().encode(decoded), raw: decoded };
  } catch {
    return null;
  }
};

export default function DataUriHelper() {
  const [name, setName] = useState('');
  const [size, setSize] = useState(0);
  const [mime, setMime] = useState('');
  const [dataUri, setDataUri] = useState('');
  const [mode, setMode] = useState('encode');
  const [input, setInput] = useState('');
  const [label, setLabel] = useState('file');
  const [error, setError] = useState('');

  const encodeFile = async (file) => {
    if (!file) return;
    const uri = await readFileAsDataURL(file);
    setDataUri(uri);
    setName(file.name);
    setSize(file.size);
    setMime(file.type || 'application/octet-stream');
    setInput(uri);
    setError('');
  };

  const encoded = dataUri
    ? {
        payload: dataUri.split(',')[1] || '',
        overhead: Math.round(((dataUri.length - size) / Math.max(1, size)) * 100),
      }
    : null;

  const decoded = mode === 'decode' ? decodeDataUri(input) : null;

  const saveDecoded = () => {
    if (!decoded) return;
    const extension = decoded.mime.split('/')[1]?.split('+')[0] || 'bin';
    downloadBlob(new Blob([decoded.bytes], { type: decoded.mime }), `${label || 'decoded'}.${extension.replace(/[^a-z0-9]/gi, '')}`);
  };

  const css = dataUri
    ? `.element {\n  background-image: url('${dataUri.slice(0, 60)}…');\n  /* full URI is ${dataUri.length.toLocaleString()} characters */\n}`
    : '';

  return (
    <ToolShell
      toolId="data-uri"
      icon={FileCode}
      title="Data URI Helper"
      desc="Inline a file as a data URI, or turn a data URI back into a real file — with the size cost made honest."
      state={{ mode, input, label }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (typeof restored.input === 'string') setInput(restored.input);
        if (typeof restored.label === 'string') setLabel(restored.label);
      }}
      exportText={mode === 'encode' ? dataUri : decoded ? `${decoded.mime} · ${decoded.bytes.length} bytes` : ''}
      exportName="data-uri.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={setMode} options={[{ value: 'encode', label: 'File → data URI' }, { value: 'decode', label: 'Data URI → file' }]} />
        {!!dataUri && <CopyBtn value={dataUri} label="Copy data URI" />}
        {mode === 'decode' && decoded && (
          <button type="button" onClick={saveDecoded} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
            Download decoded file
          </button>
        )}
      </div>

      {mode === 'encode' ? (
        <>
          <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
            <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> Choose a file</span>
            <input type="file" className="hidden" onChange={(e) => encodeFile(e.target.files?.[0])} />
          </label>

          {dataUri ? (
            <>
              <div className="grid gap-2 sm:grid-cols-4">
                <Stat label="File" value={name || '—'} />
                <Stat label="Type" value={mime || '—'} />
                <Stat label="Original" value={fmtBytes(size)} mono />
                <Stat label="As text" value={`${dataUri.length.toLocaleString()} chars`} sub={`+${encoded.overhead}%`} mono />
              </div>

              {mime.startsWith('image/') && (
                <div className="tk-card tk-depth grid place-items-center rounded-xl border border-border/70 bg-[repeating-conic-gradient(#1f2937_0%_25%,#111827_0%_50%)] bg-[length:20px_20px] p-4">
                  <img src={dataUri} alt="Inlined preview" className="max-h-48 rounded-lg" />
                </div>
              )}

              <Field label="The data URI" hint="Copy it into CSS, HTML or a JSON field">
                <Area value={dataUri.length > 4000 ? `${dataUri.slice(0, 4000)}…` : dataUri} onChange={() => {}} rows={5} mono />
              </Field>

              <Panel className="!p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">CSS usage</span>
                  <CopyBtn value={`url('${dataUri}')`} label="Copy url()" />
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono-j text-[10px] text-cyan-j">{css}</pre>
              </Panel>

              <Panel className="border-amber-500/30 text-[11px] text-amber-500">
                Base64 inflates a file by roughly a third and cannot be cached separately or compressed as well as a real file, so this is best for
                small icons and fonts — anything over a few tens of kilobytes should stay a linked file.
              </Panel>
            </>
          ) : (
            <Panel className="text-[11px] text-muted-foreground">Choose any file to inline it — it is read locally and never uploaded.</Panel>
          )}
        </>
      ) : (
        <>
          <Field label="Paste a data URI">
            <Area value={input} onChange={(value) => { setInput(value); setError(''); }} rows={7} mono placeholder="data:image/png;base64,iVBORw0KGgo…" />
          </Field>

          {input.trim() && !decoded && (
            <Panel className="border-amber-500/40 text-[11px] text-amber-500">
              That does not look like a valid data URI. It should start with <span className="font-mono-j">data:</span>, include the type, and then
              either a base64 payload after <span className="font-mono-j">;base64,</span> or a URL-encoded one.
            </Panel>
          )}

          {decoded && (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <Stat label="Detected type" value={decoded.mime} />
                <Stat label="Decoded size" value={fmtBytes(decoded.bytes.length)} mono />
                <Stat label="Payload" value={decoded.raw ? 'URL encoded text' : 'Base64 binary'} mono />
              </div>

              {decoded.mime.startsWith('image/') && (
                <div className="tk-card tk-depth grid place-items-center rounded-xl border border-border/70 bg-[repeating-conic-gradient(#1f2937_0%_25%,#111827_0%_50%)] bg-[length:20px_20px] p-4">
                  <img src={input.trim()} alt="Decoded preview" className="max-h-48 rounded-lg" />
                </div>
              )}

              {decoded.raw && (
                <Field label="Decoded text">
                  <Area value={decoded.raw.slice(0, 4000)} onChange={() => {}} rows={5} mono />
                </Field>
              )}

              <Field label="Name the downloaded file">
                <input value={label} onChange={(e) => setLabel(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
              </Field>
            </>
          )}
        </>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Useful for turning a copied data URI from a notebook or a config file back into something you can open, and for inlining a tiny logo so a
          page needs one fewer request. If the decoded file is an image, the preview above confirms it came through intact before you save it.
        </p>
      </Panel>
    </ToolShell>
  );
}