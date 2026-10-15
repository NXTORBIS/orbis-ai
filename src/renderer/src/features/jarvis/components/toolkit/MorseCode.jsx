import { useMemo, useRef, useState } from 'react';
import { Radio, Play, Square } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Seg, Area, Out, CopyBtn, Panel, ToggleRow, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.',
  '@': '.--.-.', '$': '...-..-',
};
const REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

const NATO = {
  A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
  J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'Xray', Y: 'Yankee', Z: 'Zulu',
  0: 'Zero', 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine',
};

export default function MorseCode() {
  const [mode, setMode] = useState('encode');
  const [text, setText] = useState('SOS mark32');
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef(null);

  const morse = useMemo(() => {
    if (mode === 'encode') {
      return text.toUpperCase().split('').map((c) => (c === ' ' ? '/' : MORSE[c] || c)).join(' ');
    }
    return text.trim().split(/\s+/).map((token) => (token === '/' ? ' ' : REVERSE[token] || '?')).join('').replace(/\s+/g, ' ').trim();
  }, [text, mode]);

  const stop = () => {
    ctxRef.current?.close?.();
    ctxRef.current = null;
    setPlaying(false);
  };

  const play = () => {
    const symbols = (mode === 'encode' ? morse : text).trim();
    if (!symbols) return;
    stop();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    ctxRef.current = ctx;
    const unit = 0.09;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 620;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    let t = ctx.currentTime + 0.05;
    const tokens = symbols.split(/\s+/);
    tokens.forEach((token) => {
      if (token === '/') { t += unit * 7; return; }
      Array.from(token).forEach((sym) => {
        const length = sym === '.' ? 1 : sym === '-' ? 3 : 0;
        if (length) {
          gain.gain.setValueAtTime(0.28, t);
          gain.gain.setValueAtTime(0, t + unit * length);
          t += unit * length + unit;
        }
      });
      t += unit * 2;
    });
    osc.start();
    osc.stop(t + 0.1);
    setPlaying(true);
    setTimeout(() => setPlaying(false), (t - ctx.currentTime) * 1000 + 150);
  };

  const nato = text.toUpperCase().split('').filter((c) => NATO[c]).map((c) => NATO[c]);
  const [showTable, setShowTable] = useState(false);

  return (
    <ToolShell
      toolId="morse"
      icon={Radio}
      title="Morse & Spelling Alphabet"
      desc="Translate Morse code both ways, hear it as tones, and spell anything in NATO words."
      state={{ mode, text }}
      onRestore={(saved) => { setMode(saved.mode || 'encode'); if (saved.text !== undefined) setText(saved.text); }}
      exportText={typeof morse === 'string' ? morse : ''}
      exportName="morse.txt"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'encode', label: 'Text → Morse' }, { value: 'decode', label: 'Morse → Text' }]} />
      <Area value={text} onChange={setText} rows={4} placeholder={mode === 'encode' ? 'Type a message…' : 'Paste Morse with spaces between letters and / between words…'} />
      <Out label={mode === 'encode' ? 'Morse code' : 'Plain text'} value={morse}>
        <span className="break-all font-mono-j text-sm text-cyan-j">{morse || '—'}</span>
      </Out>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={play} disabled={playing} className="gap-1.5"><Play className="h-3.5 w-3.5" /> {playing ? 'Playing…' : 'Play tones'}</Button>
        <Button size="sm" variant="outline" onClick={stop} className="gap-1.5"><Square className="h-3.5 w-3.5" /> Stop</Button>
        <CopyBtn value={morse} label="Copy result" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Characters" value={String(text.replace(/\s/g, '').length)} />
        <Stat label="Morse symbols" value={String((mode === 'encode' ? morse : text).replace(/\s/g, '').length)} />
        <Stat label="Words" value={String(text.trim() ? text.trim().split(/\s+/).length : 0)} />
      </div>
      {nato.length > 0 && (
        <Panel>
          <div className="mb-2 text-xs font-medium text-muted-foreground">NATO spelling alphabet</div>
          <div className="flex flex-wrap gap-1.5">
            {nato.slice(0, 80).map((word, i) => <span key={i} className="rounded-md bg-secondary px-2 py-1 text-[11px]">{word}</span>)}
          </div>
        </Panel>
      )}
      <ToggleRow label="Show the full Morse table" checked={showTable} onChange={setShowTable} />
      {showTable && (
        <Panel>
          <div className="grid grid-cols-4 gap-x-4 gap-y-1 font-mono-j text-[11px] sm:grid-cols-8">
            {Object.entries(MORSE).map(([char, code]) => (
              <div key={char} className="flex justify-between gap-2"><span className="text-cyan-j">{char}</span><span className="text-muted-foreground">{code}</span></div>
            ))}
          </div>
        </Panel>
      )}
    </ToolShell>
  );
}