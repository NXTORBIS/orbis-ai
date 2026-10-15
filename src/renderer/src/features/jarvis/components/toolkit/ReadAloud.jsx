import { useEffect, useRef, useState } from 'react';
import { Volume2, Play, Pause, Square } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Area, Unsupported, Stat } from './shared';

export default function ReadAloud() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [text, setText] = useState('Mark32 reads any text back to you. Paste an article, pick a voice, and press play.');
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [spoken, setSpoken] = useState(0);
  const wordsRef = useRef(0);

  useEffect(() => {
    if (!supported) return undefined;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
      setVoiceName((cur) => cur || v[0]?.name || '');
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  if (!supported) {
    return (
      <div className="space-y-4">
        <ToolHeader icon={Volume2} title="Read Aloud" desc="Speaks any pasted text using your device's own voice engine." />
        <Unsupported msg="Speech synthesis is not available in this browser." />
      </div>
    );
  }

  const play = () => {
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.name === voiceName);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = rate;
    u.pitch = pitch;
    wordsRef.current = text.trim() ? text.trim().split(/\s+/).length : 0;
    u.onboundary = (e) => setSpoken(e.charIndex);
    u.onend = () => { setSpeaking(false); setPaused(false); setSpoken(0); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
    setPaused(false);
  };

  const toggle = () => {
    if (!speaking) return play();
    if (paused) { window.speechSynthesis.resume(); setPaused(false); } else { window.speechSynthesis.pause(); setPaused(true); }
  };

  const stop = () => { window.speechSynthesis.cancel(); setSpeaking(false); setPaused(false); setSpoken(0); };

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const spokenWords = text.slice(0, spoken).trim() ? text.slice(0, spoken).trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Volume2} title="Read Aloud" desc="Speaks any pasted text using your device's own voice engine." />
      <Area value={text} onChange={setText} rows={6} placeholder="Text to read out loud…" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Voice">
          <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {voices.map((v) => <option key={v.name} value={v.name}>{`${v.name} (${v.lang})`}</option>)}
          </select>
        </Field>
        <Field label={`Speed · ${rate.toFixed(1)}×`}>
          <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Pitch · ${pitch.toFixed(1)}`}>
          <input type="range" min={0.5} max={2} step={0.1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={toggle} className="gap-1.5">
          {speaking && !paused ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {speaking ? (paused ? 'Resume' : 'Pause') : 'Play'}
        </Button>
        <Button size="sm" variant="outline" onClick={stop} className="gap-1.5"><Square className="h-3.5 w-3.5" /> Stop</Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Words" value={String(wordCount)} />
        <Stat label="Spoken" value={String(spokenWords)} />
        <Stat label="Voices" value={String(voices.length)} />
      </div>
    </div>
  );
}