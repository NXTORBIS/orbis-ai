import { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';

export default function SoundPreview({ frequencies }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const key = frequencies.join('|');
  const stop = () => {
    const session = audio.current; audio.current = null;
    if (session) { if (session.started) session.oscillators.forEach((oscillator) => oscillator.stop()); void session.context.close(); }
    setPlaying(false);
  };
  useEffect(() => { setPlaying(false); return () => {
    const session = audio.current; audio.current = null;
    if (session) { if (session.started) session.oscillators.forEach((oscillator) => oscillator.stop()); void session.context.close(); }
  }; }, [key]);
  const toggle = async () => {
    if (playing) { stop(); return; }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) { setError('This browser does not support audio playback.'); return; }
    setStarting(true);
    try {
      const context = new Context(), gain = context.createGain();
      gain.gain.setValueAtTime(0, context.currentTime); gain.gain.linearRampToValueAtTime(0.04 / frequencies.length, context.currentTime + 0.04); gain.connect(context.destination);
      const oscillators = frequencies.map((frequency) => { const oscillator = context.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = frequency; oscillator.connect(gain); return oscillator; });
      audio.current = { context, oscillators, started: false };
      await context.resume();
      if (audio.current?.context !== context) return;
      oscillators.forEach((oscillator) => oscillator.start()); audio.current.started = true; setPlaying(true); setError('');
    } catch (err) { if (audio.current) { void audio.current.context.close(); audio.current = null; } setPlaying(false); setError(err.message || 'Audio could not start.'); }
    finally { setStarting(false); }
  };
  return <div className="space-y-2">
    <Button type="button" size="sm" variant="outline" onClick={toggle} disabled={starting || frequencies.some((f) => f < 20 || f > 16000)}>{playing ? <Square /> : <Play />}{playing ? 'Stop audio' : 'Hear quiet tones'}</Button>
    <p className="text-[11px] text-muted-foreground">Real frequencies, low volume. Playback stops when the tone changes or you leave this tool.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}