import { useEffect, useRef, useState } from 'react';
import { AlarmClock as AlarmClockIcon, BellRing, Play, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Stat } from './shared';

const startTone = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    const pulse = setInterval(() => {
      try {
        gain.gain.setValueAtTime(0.2, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
      } catch { /* context closed */ }
    }, 760);
    return () => {
      clearInterval(pulse);
      try { oscillator.stop(); } catch { /* already stopped */ }
      context.close().catch(() => {});
    };
  } catch {
    return null;
  }
};

const clockText = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

export default function AlarmClock() {
  const [alarms, setAlarms] = useState([]);
  const [time, setTime] = useState('07:00');
  const [label, setLabel] = useState('Wake up');
  const [repeat, setRepeat] = useState(false);
  const [ringingId, setRingingId] = useState(null);
  const [now, setNow] = useState(new Date());
  const stopSound = useRef(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (ringingId) return;
    const current = clockText(now);
    const due = alarms.find((alarm) => alarm.time === current && !alarm.rungToday);
    if (!due) return;
    setAlarms((list) => list.map((alarm) => (alarm.id === due.id ? { ...alarm, rungToday: true } : alarm)));
    setRingingId(due.id);
  }, [now, alarms, ringingId]);

  useEffect(() => {
    if (!ringingId) return undefined;
    stopSound.current = startTone();
    return () => {
      if (typeof stopSound.current === 'function') stopSound.current();
      stopSound.current = null;
    };
  }, [ringingId]);

  const ringing = alarms.find((alarm) => alarm.id === ringingId);

  const addAlarm = () => {
    const id = Math.random().toString(36).slice(2, 8);
    setAlarms((list) => [...list, { id, time, label: label.trim() || 'Alarm', repeat, rungToday: false }]);
  };

  const snooze = (minutes) => {
    const target = new Date(Date.now() + minutes * 60000);
    const id = Math.random().toString(36).slice(2, 8);
    setAlarms((list) => [...list, { id, time: clockText(target), label: `${ringing?.label || 'Alarm'} (snoozed ${minutes}m)`, repeat: false, rungToday: false }]);
    setRingingId(null);
  };

  const testSound = () => {
    if (typeof stopSound.current === 'function') stopSound.current();
    stopSound.current = startTone();
    setTimeout(() => {
      if (typeof stopSound.current === 'function') stopSound.current();
      stopSound.current = null;
    }, 1800);
  };

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const sorted = [...alarms].sort((a, b) => a.time.localeCompare(b.time));
  const upcoming = sorted.find((alarm) => {
    const [h, m] = alarm.time.split(':').map(Number);
    return h * 60 + m > minutesNow;
  }) || sorted[0];

  return (
    <ToolShell
      toolId="alarm-clock"
      icon={AlarmClockIcon}
      title="Alarm Clock"
      desc="Set labelled alarms with daily repeats, let the tab ring when the time comes, and take a snooze when you need five more minutes."
      state={{ alarms, time, label, repeat }}
      onRestore={(restored) => {
        if (Array.isArray(restored.alarms)) setAlarms(restored.alarms.map((alarm) => ({ ...alarm, rungToday: false })));
        if (restored.time) setTime(restored.time);
        if (typeof restored.label === 'string') setLabel(restored.label);
        if (typeof restored.repeat === 'boolean') setRepeat(restored.repeat);
      }}
      exportText={alarms.map((alarm) => `${alarm.time}  ${alarm.label}${alarm.repeat ? '  (daily)' : ''}`).join('\n')}
      exportName="alarms.txt"
    >
      {ringing && (
        <div className="tk-card tk-glow-ring animate-breathe rounded-xl border border-cyan-j/60 bg-gradient-to-br from-cyan-j/20 to-transparent p-4 text-center">
          <BellRing className="mx-auto h-8 w-8 text-cyan-j" />
          <div className="tk-title-glow mt-2 text-lg font-semibold text-cyan-j">{ringing.label}</div>
          <div className="font-mono-j text-xs text-muted-foreground">{ringing.time}</div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => snooze(5)} className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] transition hover:border-cyan-j/50">Snooze 5 min</button>
            <button type="button" onClick={() => snooze(10)} className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] transition hover:border-cyan-j/50">Snooze 10 min</button>
            <button type="button" onClick={() => setRingingId(null)} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-[11px] text-cyan-j">Dismiss</button>
          </div>
        </div>
      )}

      <div className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-4 text-center">
        <div className="font-mono-j text-3xl font-semibold text-cyan-j">{now.toTimeString().slice(0, 8)}</div>
        <div className="text-[11px] text-muted-foreground">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        {upcoming && <div className="mt-1 text-[11px] text-cyan-j">Next: {upcoming.time} · {upcoming.label}</div>}
      </div>

      <div className="grid gap-3 sm:grid-cols-[130px_1fr_auto] sm:items-end">
        <Field label="Time">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="What is it for">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Wake up" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <button type="button" onClick={addAlarm} className="h-9 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Set alarm
        </button>
      </div>

      <button
        type="button"
        onClick={() => setRepeat((r) => !r)}
        className={`w-full rounded-lg border px-3 py-2 text-xs transition ${repeat ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
      >
        {repeat ? 'Repeats every day' : 'One-off alarm — tap to repeat daily'}
      </button>

      <div className="space-y-1.5">
        {alarms.map((alarm) => (
          <div key={alarm.id} className="tk-card flex items-center gap-3 rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 px-3 py-2">
            <span className="font-mono-j text-lg">{alarm.time}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs">{alarm.label}</div>
              <div className="text-[10px] text-muted-foreground">{alarm.repeat ? 'Every day' : 'Once'}{alarm.rungToday ? ' · already rang' : ''}</div>
            </div>
            <button type="button" onClick={() => setAlarms(alarms.filter((a) => a.id !== alarm.id))} className="text-muted-foreground transition hover:text-red-500">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {!alarms.length && <Panel className="text-[11px] text-muted-foreground">No alarms yet — pick a time and set one.</Panel>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAlarms((list) => list.map((alarm) => ({ ...alarm, rungToday: false })))}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          Reset today's alarms
        </button>
        <button type="button" onClick={testSound} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50">
          <Play className="h-3.5 w-3.5" /> Test the sound
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Alarms set" value={String(alarms.length)} mono />
        <Stat label="Repeating" value={String(alarms.filter((a) => a.repeat).length)} mono />
        <Stat label="Next up" value={upcoming ? upcoming.time : '—'} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The tone is generated by the browser, so there is nothing to download, and it keeps sounding while this tab stays open in the background —
          leave the tab alive and your device volume up. For an alarm that must fire with the browser fully closed, use your phone or computer's own
          clock app.
        </p>
      </Panel>
    </ToolShell>
  );
}