import { useState } from 'react';
import { Braces, Copy, Check, Minimize2, Sparkles } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, CopyBtn } from './shared';

export default function JsonValidator() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);

  const validate = () => {
    if (!text.trim()) { setResult({ ok: false, msg: 'Empty input' }); return; }
    try {
      const obj = JSON.parse(text);
      setResult({ ok: true, msg: 'Valid JSON', formatted: JSON.stringify(obj, null, 2), minified: JSON.stringify(obj) });
    } catch (e) {
      const m = e.message.match(/position (\d+)/i);
      let pos = null;
      if (m) { const p = +m[1]; pos = `near char ${p}`; }
      setResult({ ok: false, msg: `${e.message}${pos ? ` (${pos})` : ''}` });
    }
  };
  const format = () => { if (result?.formatted) setText(result.formatted); };
  const minify = () => { if (result?.minified) setText(result.minified); };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Braces} title="JSON Validator" desc="Validate, format and minify JSON with exact error locations." />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='{"key": "value"}' className="h-48 w-full rounded-md border border-input bg-transparent p-3 font-mono-j text-sm focus-visible:ring-1 focus-visible:ring-ring" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={validate} className="gap-1.5"><Sparkles className="h-4 w-4" /> Validate</Button>
        <Button size="sm" variant="outline" onClick={format} disabled={!result?.formatted}>Format</Button>
        <Button size="sm" variant="outline" onClick={minify} disabled={!result?.minified} className="gap-1.5"><Minimize2 className="h-4 w-4" /> Minify</Button>
        {result?.formatted && <CopyBtn value={result.formatted} label="Copy formatted" />}
      </div>
      {result && (
        <div className={`rounded-lg border p-3 text-sm ${result.ok ? 'border-green-500/40 bg-green-500/5 text-green-600 dark:text-green-400' : 'border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400'}`}>
          {result.msg}
        </div>
      )}
    </div>
  );
}