import { useState } from 'react';
import { QrCode, Download } from 'lucide-react';
import { ToolHeader, Field, Seg, Area, CopyBtn, Panel, Stat } from './shared';

export default function QrCodeGenerator() {
  const [text, setText] = useState('https://mark37.base44.app');
  const [size, setSize] = useState(300);
  const [margin, setMargin] = useState(8);

  const trimmed = text.trim();
  const url = trimmed
    ? `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=${margin}&data=${encodeURIComponent(trimmed)}`
    : '';

  return (
    <div className="space-y-4">
      <ToolHeader icon={QrCode} title="QR Code Generator" desc="Turn a link or any text into a scannable QR code you can save." />
      <Area value={text} onChange={setText} rows={3} placeholder="Link, text, phone number, Wi-Fi string…" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Size">
          <Seg value={size} onChange={setSize} options={[{ value: 200, label: '200px' }, { value: 300, label: '300px' }, { value: 500, label: '500px' }, { value: 800, label: '800px' }]} />
        </Field>
        <Field label="Quiet margin">
          <input type="range" min={0} max={30} step={2} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>
      {url ? (
        <>
          <Panel className="grid place-items-center gap-3">
            <div className="rounded-2xl bg-white p-3 shadow-lg">
              <img src={url} alt="Generated QR code" width={Math.min(size, 260)} height={Math.min(size, 260)} className="block" />
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" /> Open / save image
              </a>
              <CopyBtn value={url} label="Copy image URL" />
            </div>
          </Panel>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Characters" value={String(trimmed.length)} />
            <Stat label="Size" value={`${size}px`} />
            <Stat label="Encoding" value={`${trimmed.length > 200 ? 'Dense' : 'Light'}`} />
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border/70 px-6 py-12 text-center text-sm text-muted-foreground">
          Type something to generate a QR code.
        </div>
      )}
    </div>
  );
}