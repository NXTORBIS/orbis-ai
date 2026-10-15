import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { Hero, Pills, Ring } from '../kit/premium';
import { Panel, Seg, Stat } from '../shared';
import { useStoredState } from '../kit/hooks';

const FONTS = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Palatino', 'Garamond', 'Bookman', 'Arial Black', 'Calibri', 'Cambria', 'Consolas', 'Segoe UI', 'Roboto', 'Ubuntu', 'Fira Sans', 'Inter', 'Noto Sans', 'Menlo', 'Monaco', 'DejaVu Sans', 'Liberation Sans'];

// Approximate entropy per signal, following the shape of published fingerprinting
// research (Panopticlick / AmIUnique). These are literature figures, not measurements of
// this device, so treat them as an indication of which signals discriminate most.
const ENTROPY = {
  canvas: 8.6, webgl: 9.4, audio: 5.4, fonts: 8.0, screen: 4.7, timezone: 3.0,
  locale: 3.2, hardware: 3.6, touch: 2.4, platform: 4.6, media: 3.8, quota: 2.2, media_features: 2.0,
};

const hash = (input) => {
  let h = 2166136261;
  const text = String(input);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const groupId = (parts) => {
  const joined = parts.map((part) => hash(part)).join('');
  return (joined.slice(0, 4) + '-' + joined.slice(8, 12) + '-' + joined.slice(16, 20)).toUpperCase();
};

function canvasSignal() {
  const element = document.createElement('canvas');
  element.width = 320;
  element.height = 80;
  const ctx = element.getContext('2d');
  if (!ctx) return null;
  ctx.textBaseline = 'top';
  ctx.font = '16px "Arial"';
  ctx.fillStyle = '#f60';
  ctx.fillRect(10, 10, 120, 40);
  ctx.fillStyle = '#069';
  ctx.fillText('Fingerprint ẞ 漢 🜁', 14, 16);
  ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
  ctx.fillText('Fingerprint ẞ 漢 🜁', 16, 34);
  ctx.globalCompositeOperation = 'multiply';
  ctx.beginPath();
  ctx.arc(60, 50, 30, 0, Math.PI * 2);
  ctx.fill();
  return element.toDataURL();
}

function webglSignal() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const parts = [
      info ? String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL)) : 'vendor hidden',
      info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'renderer hidden',
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      gl.getParameter(gl.MAX_VIEWPORT_DIMS)?.join('x'),
      (gl.getSupportedExtensions() || []).length,
    ];
    return parts.join(' | ');
  } catch {
    return null;
  }
}

async function audioSignal() {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx(1, 44100, 44100);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 1000;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -50;
  compressor.knee.value = 40;
  compressor.ratio.value = 12;
  osc.connect(compressor);
  compressor.connect(ctx.destination);
  osc.start(0);
  const buffer = await ctx.startRendering();
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
  return sum.toFixed(8);
}

function fontSignal() {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return { present: [], note: 'no canvas' };
  const probe = 'mmmmmmmmmmlliWWQ@';
  const measure = (family) => {
    ctx.font = '72px ' + family;
    return ctx.measureText(probe).width;
  };
  const base = { monospace: measure('monospace'), 'sans-serif': measure('sans-serif'), serif: measure('serif') };
  const present = FONTS.filter((family) => {
    const m = measure('"' + family + '", monospace') !== base.monospace
      || measure('"' + family + '", sans-serif') !== base['sans-serif']
      || measure('"' + family + '", serif') !== base.serif;
    return m;
  });
  return { present, note: 'width comparison against three generic families' };
}

export default function FingerprintAudit() {
  const [signals, setSignals] = useState([]);
  const [running, setRunning] = useState(false);
  const [scope, setScope] = useState('all');
  const [previous, setPrevious] = useStoredState('tk:fingerprint:last', null);
  const [comparison, setComparison] = useState(null);
  const previousRef = useRef(previous);

  useEffect(() => { previousRef.current = previous; }, [previous]);

  const run = useCallback(async () => {
    setRunning(true);
    const rows = [];
    const push = (key, label, value, note) => {
      if (value === null || value === undefined || value === '') return;
      rows.push({ key, label, value: String(value), note, bits: ENTROPY[key] ?? 1 });
    };

    const canvasValue = canvasSignal();
    push('canvas', 'Canvas rendering', canvasValue ? hash(canvasValue) : null, 'Text and vector antialiasing differ by GPU, driver and font stack. The single strongest signal here.');

    const webglValue = webglSignal();
    push('webgl', 'WebGL renderer', webglValue ? hash(webglValue) : null, 'GPU model and driver limits. Often hidden behind a generic string for privacy.');

    const audioValue = await audioSignal().catch(() => null);
    push('audio', 'Audio processing', audioValue ? hash(audioValue) : null, 'Tiny floating-point differences in the audio pipeline, which vary by hardware and OS.');

    const fonts = fontSignal();
    push('fonts', 'Installed fonts', fonts.present.length ? hash(fonts.present.join(',')) : null, fonts.present.length + ' of ' + FONTS.length + ' common families detected by ' + fonts.note + '.');

    const media = [
      screen.width, screen.height, screen.availWidth, screen.availHeight,
      screen.colorDepth, screen.pixelDepth, window.devicePixelRatio,
      window.innerWidth, window.innerHeight, screen.orientation?.type || 'unknown',
    ].join(' x ');
    push('screen', 'Screen geometry', media, 'Resolution, available area and pixel ratio — a small set of combinations covers most devices.');

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = new Date().getTimezoneOffset();
    push('timezone', 'Time zone', tz + ' (' + offset + ')', 'Narrow, and stable across sessions. A strong signal on its own when paired with a language.');

    push('locale', 'Language and locale', (navigator.languages || [navigator.language]).join(',') + ' · ' + Intl.DateTimeFormat().resolvedOptions().locale, 'Language preference list, in order.');

    push('hardware', 'Hardware', (navigator.hardwareConcurrency || 'unknown') + ' threads · ' + (navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'memory hidden'), 'Core count and memory class, rounded by the browser for privacy.');

    push('touch', 'Touch points', String(navigator.maxTouchPoints ?? 0) + ' · ' + (window.matchMedia('(pointer: fine)').matches ? 'fine pointer' : 'coarse pointer'), 'Touch support and input type.');

    push('platform', 'Platform and browser', navigator.userAgent, 'The string every site can read, and the first thing a fingerprint uses.');

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const kinds = devices.map((device) => device.kind).sort().join(',');
      push('media', 'Media devices', devices.length + ' devices (' + kinds + ')', 'Counts and kinds of cameras, microphones and speakers, without their names.');
    } catch {
      push('media', 'Media devices', null, '');
    }

    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate().catch(() => null);
      if (estimate?.quota) {
        push('quota', 'Storage quota', (estimate.quota / 1e9).toFixed(2) + ' GB', 'Quota comes from free disk space and browser policy, so it drifts with the machine.');
      }
    }

    push('media_features', 'Preferences', [
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced-motion' : 'full-motion',
      window.matchMedia('(prefers-contrast: more)').matches ? 'high-contrast' : 'normal-contrast',
      navigator.doNotTrack === '1' ? 'DNT' : 'no-DNT',
      navigator.globalPrivacyControl ? 'GPC' : 'no-GPC',
    ].join(', '), 'Accessibility and privacy preferences, readable by any page without a prompt.');

    setRunning(false);
    setSignals(rows);
    const id = groupId(rows.map((row) => row.value));
    const prior = previousRef.current;
    setComparison(prior ? { id, previous: prior.id, same: prior.id === id } : { id, previous: null, same: null });
    setPrevious({ id, bits: rows.reduce((sum, row) => sum + row.bits, 0), at: Date.now() });
  }, []);

  useEffect(() => { run(); }, [run]);

  const totalBits = signals.reduce((sum, row) => sum + row.bits, 0);
  const fingerprintId = comparison?.id || (signals.length ? groupId(signals.map((row) => row.value)) : '—');
  const shown = scope === 'all' ? signals : scope === 'strong' ? signals.filter((row) => row.bits >= 4) : signals.filter((row) => row.bits < 4);

  const report = [
    'Fingerprint id ' + fingerprintId,
    'Signals exposed: ' + signals.length,
    'Estimated entropy: ' + totalBits.toFixed(1) + ' bits — roughly one in ' + (totalBits > 53 ? 'more than 9 quadrillion' : Math.round(Math.pow(2, totalBits)).toLocaleString()) + ' devices by this estimate',
    comparison?.previous ? 'Previous run in this browser: ' + comparison.previous + (comparison.same ? ' (identical)' : ' (changed)') : '',
    '',
    ...signals.map((row) => row.label + ' [' + row.bits.toFixed(1) + ' bits]: ' + row.value),
    '',
    'Nothing here is sent anywhere. The hashes are computed in this tab and kept in local storage for the comparison only.',
  ].filter(Boolean).join('\n');

  return (
    <ToolShell
      toolId="fingerprint-audit"
      icon={Fingerprint}
      title="Fingerprint Exposure Audit"
      desc="Every stable signal a page can read from this browser without a cookie, hashed into one device profile, with an entropy estimate and how to blunt each one."
      exportText={report}
      exportName="fingerprint-audit.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={run} disabled={running} className="gap-1.5">
          <RefreshCw className={running ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> {running ? 'Reading signals…' : 'Read signals again'}
        </Button>
        <span className="text-[11px] text-muted-foreground">Computed locally. Nothing is sent, stored on a server, or shared.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr]">
        <Hero
          label="Device profile id"
          value={fingerprintId}
          sub={signals.length + ' signals read without a cookie, and no prompt shown'}
          tone="violet"
        />
        <Ring
          value={Math.min(100, (totalBits / 50) * 100)}
          max={100}
          tone={totalBits > 30 ? 'rose' : totalBits > 18 ? 'amber' : 'emerald'}
          label="Entropy estimate"
          sub={totalBits.toFixed(1) + ' bits against a 50-bit scale — a common desktop lands near 30'}
        />
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Signals read" value={String(signals.length)} mono sub="all without permission" />
          <Stat
            label="Last run"
            value={comparison?.previous ? (comparison.same ? 'identical' : 'changed') : 'first run'}
            mono
            sub={comparison?.previous ? 'stored in this browser' : 'run again to compare'}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium">What was read</span>
            <Seg value={scope} onChange={setScope} options={[{ value: 'all', label: 'All' }, { value: 'strong', label: 'Strongest' }, { value: 'weak', label: 'Minor' }]} />
          </div>
          <div className="divide-y divide-border/40">
            {shown.map((row) => (
              <div key={row.key} className="py-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px]">{row.label}</span>
                  <span className="shrink-0 font-mono-j text-[10px] text-cyan-j">{row.bits.toFixed(1)} bits</span>
                </div>
                <div className="truncate font-mono-j text-[10px] text-muted-foreground" title={row.value}>{row.value}</div>
                {row.note && <div className="mt-0.5 text-[10px] text-muted-foreground/80">{row.note}</div>}
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="!p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="h-3.5 w-3.5 text-cyan-j" /> How to blunt it</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A private or incognito window does not change these signals. It hides history, not the device.</p>
            <p>· Firefox with <span className="font-mono-j">privacy.resistFingerprinting</span> rounds screen size, spoofs the time zone to UTC and blocks canvas reads — the most effective single change.</p>
            <p>· Tor Browser ships that same protection plus a uniform window size, which is why its users blend into one another.</p>
            <p>· Brave randomises canvas and audio output per session, which breaks the stability of two of the strongest signals.</p>
            <p>· Blocking JavaScript entirely defeats all of this, and breaks nearly every site. It is a real trade, not a free win.</p>
            <p>· Extensions that spoof the user agent usually leave the rest untouched, so the profile becomes contradictory — which can make it more distinctive, not less.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading these numbers honestly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The entropy figures are taken from published fingerprinting research, not measured across a population. They say which signals discriminate most, not how unique this exact device is.</p>
            <p>· Adding bits assumes the signals are independent. They are not: the platform, the fonts and the user agent overlap heavily, so the real total is lower.</p>
            <p>· A single machine is not identified by any one signal. It is identified by the combination staying the same while everything else about the visit changes.</p>
            <p>· Stability is what makes it work. If the id changes between these runs, one of the signals is volatile — a window resize or a different screen changes the geometry, for instance.</p>
            <p>· This is also why the audit is useful on your own machine: a device profile that stays identical after you think you have cleaned up tells you what actually leaks.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Signals that change between visits</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Window and viewport size, whenever you resize or rotate.</p>
            <p>· Storage quota, which follows free disk space and other sites’ usage.</p>
            <p>· Connected media devices, as cameras and headsets come and go.</p>
            <p>· Browser version, after every update — which is why fingerprinters combine signals rather than trusting one.</p>
            <p className="text-cyan-j">Comparing runs here is the practical test: stable signals are the ones worth defending.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Id', value: fingerprintId },
                { label: 'Bits', value: totalBits.toFixed(1) },
                { label: 'Signals', value: String(signals.length) },
              ]}
            />
          </div>
        </Panel>
      </div>
    </ToolShell>
  );
}