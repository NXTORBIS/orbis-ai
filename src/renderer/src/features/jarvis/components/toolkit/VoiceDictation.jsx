import { useEffect, useRef, useState } from 'react';
import { Mic, Play, Square } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Stat, CopyBtn, Panel, Unsupported } from './shared';

const LANGS = [
  ['en-US', 'English (US)'], ['en-IN', 'English (India)'], ['en-GB', 'English (UK)'],
  ['hi-IN', 'हिन्दी'], ['es-ES', 'Español'], ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'], ['ja-JP', '日本語'], ['ar-SA', 'العربية'],
];

export default function VoiceDictation() {
  const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [lang, setLang] = useState('en-US');
  const [err, setErr] = useState(null);
  const recRef = useRef(null);

  useEffect(() => () => recRef.current?.stop?.(), []);

  if (!Recognition) {
    return (
      <div className="space-y-4">
        <ToolHeader icon={Mic} title="Voice Dictation" desc="Speak and watch your words appear as text." />
        <Unsupported msg="Speech recognition is not available in this browser. It currently works best in Chrome and Edge." />
      </div>
    );
  }

  const start = () => {
    setErr(null);
    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (event) => {
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) setFinalText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${result[0].transcript.trim()}`);
        else live += result[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (event) => { setErr(event.error === 'not-allowed' ? 'Microphone permission was blocked.' : `Recognition error: ${event.error}`); setListening(false); };
    rec.onend = () => { setListening(false); setInterim(''); };
    try { rec.start(); } catch { setErr('Could not start the microphone.'); return; }
    recRef.current = rec;
    setListening(true);
  };

  const stop = () => { recRef.current?.stop(); setListening(false); setInterim(''); };

  const words = finalText.trim() ? finalText.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Mic} title="Voice Dictation" desc="Speak and watch your words appear — then copy the transcript anywhere." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Language">
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {LANGS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </Field>
        <div className="flex items-end gap-2">
          {!listening ? (
            <Button size="sm" onClick={start} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Start listening</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={stop} className="gap-1.5"><Square className="h-3.5 w-3.5" /> Stop</Button>
          )}
          <CopyBtn value={finalText} label="Copy transcript" />
        </div>
      </div>
      {err && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{err}</div>}
      <Panel>
        <div className="mb-2 flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${listening ? 'bg-red-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
          <span className="text-xs text-muted-foreground">{listening ? 'Listening… speak normally' : 'Microphone idle'}</span>
        </div>
        <div className="min-h-40 whitespace-pre-wrap text-sm leading-relaxed">
          {finalText || <span className="text-muted-foreground">Your words will appear here.</span>}
          {interim && <span className="text-muted-foreground italic"> {interim}</span>}
        </div>
      </Panel>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Words" value={String(words)} />
        <Stat label="Characters" value={String(finalText.length)} />
        <Stat label="Language" value={lang} mono />
      </div>
      <p className="text-[11px] text-muted-foreground">Recognition runs through your browser's own speech service, so accuracy depends on your microphone and connection.</p>
    </div>
  );
}