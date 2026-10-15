import { useEffect, useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import ToolShell from '../kit/ToolShell';
import { Bars, Hero, Pills } from '../kit/premium';
import { Panel, Seg, Stat } from '../shared';

const canvas = () => document.createElement('canvas');
const video = () => document.createElement('video');

const GROUPS = [
  {
    id: 'graphics', label: 'Graphics, sound & video',
    items: [
      ['WebGL 2', () => !!canvas().getContext('webgl2'), 'Hardware 3D. Missing on locked-down or very old devices, and blocked when the GPU is disabled.'],
      ['WebGPU', () => 'gpu' in navigator, 'The modern compute and graphics API. Still rolling out, so treat it as a bonus.'],
      ['Canvas 2D', () => !!canvas().getContext('2d'), 'Drawing, charts and image processing. Present nearly everywhere.'],
      ['OffscreenCanvas', () => 'OffscreenCanvas' in window, 'Canvas drawing off the main thread, so heavy rendering does not freeze the page.'],
      ['WebCodecs', () => 'VideoDecoder' in window, 'Frame-level video encode and decode, used for editing and thumbnails.'],
      ['MediaRecorder', () => 'MediaRecorder' in window, 'Recording microphone, camera or screen to a file.'],
      ['Screen capture', () => !!navigator.mediaDevices?.getDisplayMedia, 'Sharing a screen, window or tab. Firefox on Android does not offer it.'],
      ['Picture-in-picture', () => 'pictureInPictureEnabled' in document, 'Floating video window. Video only.'],
      ['H.264 playback', () => !!video().canPlayType('video/mp4; codecs="avc1.42E01E"'), 'The safest video codec to ship. Software decoding may be used if hardware support is absent.'],
      ['VP9 playback', () => !!video().canPlayType('video/webm; codecs="vp9"'), 'Efficient open codec, well supported in Chromium and Firefox.'],
      ['AV1 playback', () => !!video().canPlayType('video/mp4; codecs="av01.0.05M.08"'), 'Best compression, heaviest to decode. Newer hardware handles it natively.'],
      ['Opus audio', () => !!video().canPlayType('audio/ogg; codecs="opus"'), 'The default for voice and web audio in most browsers.'],
      ['Web Audio', () => 'AudioContext' in window || 'webkitAudioContext' in window, 'Synthesis, filters and analysis. The basis of every tuner and meter.'],
      ['Web Animations', () => 'animate' in Element.prototype, 'Scripted animation without a library.'],
      ['backdrop-filter', () => CSS.supports('backdrop-filter', 'blur(4px)') || CSS.supports('-webkit-backdrop-filter', 'blur(4px)'), 'Frosted glass panels. Costs GPU time on every repaint.'],
      ['Container queries', () => CSS.supports('container-type', 'inline-size'), 'Layout driven by the element’s own width rather than the viewport.'],
      [':has() selector', () => CSS.supports('selector(:has(a))'), 'Styling a parent from its children.'],
    ],
  },
  {
    id: 'input', label: 'Input, sensors & devices',
    items: [
      ['Touch input', () => navigator.maxTouchPoints > 0, 'Reports touch points, not whether a touchscreen is physically present.'],
      ['Pointer events', () => 'PointerEvent' in window, 'One event model for mouse, pen and touch.'],
      ['Stylus pressure', () => 'PointerEvent' in window && 'pressure' in PointerEvent.prototype, 'Pen pressure and tilt. Reported as 0.5 for mice, so presence is not proof of a pen.'],
      ['Gamepad API', () => 'getGamepads' in navigator, 'Reads connected controllers. Devices appear only after a button is pressed.'],
      ['Keyboard layout', () => !!navigator.keyboard?.getLayoutMap, 'The physical key layout, for shortcut hints that match the keyboard.'],
      ['Vibration', () => 'vibrate' in navigator, 'Short haptics. Ignored on desktop and on iOS.'],
      ['Accelerometer', () => 'Accelerometer' in window, 'Motion sensors, usually without a permission prompt only on Android.'],
      ['Gyroscope', () => 'Gyroscope' in window, 'Rotation rate.'],
      ['Magnetometer', () => 'Magnetometer' in window, 'Compass heading. Rarely exposed outside Android.'],
      ['Ambient light', () => 'AmbientLightSensor' in window, 'Effectively Android-only and disabled in most desktop browsers.'],
      ['Web MIDI', () => 'requestMIDIAccess' in navigator, 'Access to MIDI keyboards and controllers, behind a permission prompt.'],
      ['Clipboard read', () => !!navigator.clipboard?.readText, 'Reading the clipboard. Needs permission and often a user gesture.'],
      ['Clipboard write', () => !!navigator.clipboard?.writeText, 'Copy buttons. Falls back to a hidden text field when missing.'],
      ['Web Share', () => !!navigator.share, 'The native share sheet, mostly on mobile.'],
      ['File drag and drop', () => 'DataTransferItem' in window, 'Dragging files onto the page.'],
      ['Fullscreen', () => !!document.documentElement.requestFullscreen, 'True fullscreen, without browser chrome.'],
    ],
  },
  {
    id: 'storage', label: 'Storage & compute',
    items: [
      ['localStorage', () => { try { window.localStorage.setItem('__probe', '1'); window.localStorage.removeItem('__probe'); return true; } catch { return false; } }, 'Synchronous key-value storage. Blocked in some private modes.'],
      ['IndexedDB', () => 'indexedDB' in window, 'The real database in the browser.'],
      ['Cache API', () => 'caches' in window, 'File storage for offline use, driven by a service worker.'],
      ['Service worker', () => 'serviceWorker' in navigator, 'Required for offline support, push notifications and background sync.'],
      ['Web workers', () => 'Worker' in window, 'Keeps heavy work off the main thread.'],
      ['SharedArrayBuffer', () => typeof SharedArrayBuffer === 'function' && window.crossOriginIsolated === true, 'Shared memory between threads. Only available with cross-origin isolation headers.'],
      ['WebAssembly', () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); } catch { return false; } }, 'Near-native speed for compute-heavy code.'],
      ['Web Crypto', () => !!(window.crypto && crypto.subtle), 'Hashing, encryption and signing in the browser.'],
      ['Compression streams', () => 'CompressionStream' in window, 'gzip and deflate without shipping a library.'],
      ['File System Access', () => 'showOpenFilePicker' in window, 'Real files on disk, with the user picking them. Chromium only.'],
      ['Private file system', () => !!navigator.storage?.getDirectory, 'An origin-private folder for large files, no prompts.'],
      ['Storage buckets', () => 'storageBuckets' in navigator.storage, 'Separate, labelled storage that can expire independently.'],
    ],
  },
  {
    id: 'network', label: 'Network & realtime',
    items: [
      ['fetch', () => 'fetch' in window, 'Every API call this app makes.'],
      ['WebSocket', () => 'WebSocket' in window, 'Two-way live connection. Proxies and corporate filters often break it.'],
      ['Server-sent events', () => 'EventSource' in window, 'One-way streaming from the server.'],
      ['WebRTC', () => 'RTCPeerConnection' in window, 'Peer-to-peer audio, video and data. Blocked in some networks entirely.'],
      ['WebTransport', () => 'WebTransport' in window, 'HTTP/3-based transport for games and live media.'],
      ['BroadcastChannel', () => 'BroadcastChannel' in window, 'Messaging between tabs of the same origin.'],
      ['Notifications', () => 'Notification' in window, 'System notifications, behind a permission prompt.'],
      ['Push messaging', () => 'PushManager' in window && 'serviceWorker' in navigator, 'Server-sent notifications while the app is closed. On iOS this needs the app installed to the home screen.'],
      ['Background sync', () => 'SyncManager' in window, 'Retries a failed action once the connection returns.'],
      ['Network Information', () => 'connection' in navigator, 'Connection type, downlink and round-trip estimate. Chromium only.'],
      ['Send beacon', () => !!navigator.sendBeacon, 'Sends analytics as the page closes, without blocking it.'],
      ['Web Locks', () => !!navigator.locks?.request, 'Coordinates work between tabs so a sync does not run twice.'],
      ['Event timing', () => 'PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('event'), 'Measures how long a user interaction took to paint.'],
      ['Resource timing', () => 'PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('resource'), 'Per-request sizes and timings, the basis of any page-weight audit.'],
    ],
  },
  {
    id: 'device', label: 'Device access & identity',
    items: [
      ['Geolocation', () => 'geolocation' in navigator, 'Position, behind a permission prompt.'],
      ['Camera and microphone', () => !!navigator.mediaDevices?.getUserMedia, 'Live capture, behind a permission prompt.'],
      ['Device enumeration', () => !!navigator.mediaDevices?.enumerateDevices, 'Lists device kinds without labels until permission is granted.'],
      ['Web Bluetooth', () => 'bluetooth' in navigator, 'Pairs with nearby devices. Chromium on desktop and Android only.'],
      ['Web USB', () => 'usb' in navigator, 'Direct access to USB hardware.'],
      ['Web HID', () => 'hid' in navigator, 'Keyboards, gamepads and specialist hardware over USB or Bluetooth.'],
      ['Web Serial', () => 'serial' in navigator, 'Microcontrollers and lab equipment over a serial port.'],
      ['Web NFC', () => 'NDEFReader' in window, 'Android Chrome only.'],
      ['Wake lock', () => 'wakeLock' in navigator, 'Keeps the screen awake, which costs battery deliberately.'],
      ['Idle detection', () => 'IdleDetector' in window, 'Whether the user has stepped away. Behind a permission prompt.'],
      ['Payment request', () => 'PaymentRequest' in window, 'The browser’s own payment sheet.'],
      ['Passkeys', () => !!(window.PublicKeyCredential && navigator.credentials), 'Hardware-backed sign-in.'],
      ['Speech recognition', () => 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window, 'Dictation using the browser engine. Often needs a network round trip.'],
      ['Speech synthesis', () => 'speechSynthesis' in window, 'Reading text aloud with system voices.'],
      ['Screen orientation lock', () => !!screen.orientation?.lock, 'Pins the display, usually only in fullscreen.'],
      ['Screen details', () => 'getScreenDetails' in window, 'Multi-screen layout, behind a permission prompt.'],
    ],
  },
];

const PERMISSIONS = ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read', 'clipboard-write', 'persistent-storage', 'push', 'midi', 'background-sync', 'screen-wake-lock', 'idle-detection'];

const safeTest = (test) => {
  try {
    const value = test();
    return value === true || value === 'partial' ? value : false;
  } catch {
    return false;
  }
};

const FILTERS = [
  { value: 'all', label: 'Everything' },
  { value: 'yes', label: 'Supported' },
  { value: 'no', label: 'Missing' },
];

export default function CapabilityAudit() {
  const [report, setReport] = useState(null);
  const [filter, setFilter] = useState('all');
  const [pads, setPads] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const groups = GROUPS.map((group) => ({
        ...group,
        rows: group.items.map(([label, test, note]) => ({ label, note, ok: safeTest(test) })),
      }));
      let devices = [];
      try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { devices = []; }
      let perms = {};
      if (navigator.permissions?.query) {
        for (const name of PERMISSIONS) {
          try {
            const status = await navigator.permissions.query({ name });
            perms[name] = status.state;
          } catch {
            perms[name] = null;
          }
        }
      }
      let estimateQuota = null;
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate().catch(() => null);
        estimateQuota = estimate?.quota ?? null;
      }
      const voices = 'speechSynthesis' in window ? (window.speechSynthesis.getVoices() || []).length : 0;
      if (!alive) return;
      setReport({ groups, devices, perms, estimateQuota, voices });
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const read = () => setPads(navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []);
    read();
    window.addEventListener('gamepadconnected', read);
    window.addEventListener('gamepaddisconnected', read);
    const id = setInterval(read, 2500);
    return () => {
      window.removeEventListener('gamepadconnected', read);
      window.removeEventListener('gamepaddisconnected', read);
      clearInterval(id);
    };
  }, []);

  const totals = useMemo(() => {
    if (!report) return null;
    const all = report.groups.flatMap((group) => group.rows);
    const supported = all.filter((row) => row.ok === true).length;
    return { total: all.length, supported, missing: all.length - supported };
  }, [report]);

  const deviceCounts = useMemo(() => {
    if (!report) return null;
    const byKind = {};
    report.devices.forEach((device) => { byKind[device.kind] = (byKind[device.kind] || 0) + 1; });
    const labelled = report.devices.some((device) => device.label);
    return { byKind, labelled, total: report.devices.length };
  }, [report]);

  const privacySignals = useMemo(() => [
    { label: 'Do Not Track', value: navigator.doNotTrack === '1' ? 'set' : 'not set' },
    { label: 'Global Privacy Control', value: navigator.globalPrivacyControl ? 'set' : 'not set' },
    { label: 'Cookies enabled', value: String(navigator.cookieEnabled) },
    { label: 'Private mode hint', value: report?.estimateQuota != null ? (report.estimateQuota < 1.2e9 ? 'quota looks small — possibly private or a very full disk' : 'quota looks normal') : 'unknown' },
    { label: 'Speech voices', value: String(report?.voices ?? 0) },
    { label: 'Extended screens', value: screen.isExtended ? 'reported' : 'not reported' },
  ], [report]);

  const reportText = report ? [
    'Capabilities: ' + totals.supported + ' of ' + totals.total + ' present, ' + totals.missing + ' missing',
    '',
    ...report.groups.map((group) => [
      group.label.toUpperCase(),
      ...group.rows.map((row) => (row.ok ? '[yes] ' : '[no ] ') + row.label + ' — ' + row.note),
      '',
    ].join('\n')),
    'Gamepads connected: ' + (pads.length ? pads.map((pad) => pad.id).join(', ') : 'none'),
    'Media devices: ' + (deviceCounts.total ? Object.entries(deviceCounts.byKind).map(([kind, count]) => count + ' ' + kind).join(', ') : 'none reported') + (deviceCounts.labelled ? ' (labels visible)' : ' (labels hidden until permission is granted)'),
    '',
    'PERMISSIONS',
    ...PERMISSIONS.map((name) => name + ': ' + (report.perms[name] || 'not queryable')),
    '',
    ...privacySignals.map((row) => row.label + ': ' + row.value),
  ].join('\n') : '';

  return (
    <ToolShell
      toolId="capabilities"
      icon={ListChecks}
      title="Browser Capability Audit"
      desc="Around ninety web APIs tested live on this device — graphics, codecs, input, storage, network and device access — plus the permission states this browser exposes."
      state={{ filter }}
      onRestore={(restored) => { if (restored.filter) setFilter(restored.filter); }}
      exportText={reportText}
      exportName="capability-audit.txt"
    >
      {!report && (
        <Panel className="!p-3"><p className="text-[11px] text-muted-foreground">Running the probes…</p></Panel>
      )}

      {report && totals && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero
              label="APIs available here"
              value={totals.supported}
              sub={'of ' + totals.total + ' probed · ' + totals.missing + ' missing on this browser and device'}
              tone={totals.supported / totals.total > 0.9 ? 'emerald' : 'cyan'}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {report.groups.map((group) => {
                const yes = group.rows.filter((row) => row.ok).length;
                return (
                  <Stat
                    key={group.id}
                    label={group.label.split(',')[0]}
                    value={yes + '/' + group.rows.length}
                    mono
                    sub={Math.round((yes / group.rows.length) * 100) + '% present'}
                  />
                );
              })}
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">Support by group</span>
              <Seg value={filter} onChange={setFilter} options={FILTERS} />
            </div>
            <Bars
              data={report.groups.map((group) => ({ label: group.label.split(',')[0], value: Math.round((group.rows.filter((row) => row.ok).length / group.rows.length) * 100) }))}
              format={(value) => value + '%'}
              suffix=""
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Support here means the API exists on this browser and hardware. It does not mean permission has been granted, and it does not mean the feature will work over a
              hostile network.
            </p>
          </Panel>

          {report.groups.map((group) => {
            const rows = group.rows.filter((row) => filter === 'all' || (filter === 'yes' ? row.ok : !row.ok));
            if (!rows.length) return null;
            return (
              <Panel key={group.id} className="!p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-j">{group.label}</span>
                  <span className="text-[10px] text-muted-foreground">{group.rows.filter((row) => row.ok).length} of {group.rows.length}</span>
                </div>
                <div className="divide-y divide-border/40">
                  {rows.map((row) => (
                    <div key={row.label} className="flex items-start justify-between gap-4 py-1.5">
                      <div className="min-w-0">
                        <div className="text-[12px]">{row.label}</div>
                        <div className="text-[10px] text-muted-foreground">{row.note}</div>
                      </div>
                      <span className={row.ok ? 'shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono-j text-[10px] text-emerald-400' : 'shrink-0 rounded-md border border-border/60 px-2 py-0.5 font-mono-j text-[10px] text-muted-foreground'}>
                        {row.ok ? 'yes' : 'no'}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            );
          })}

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Live input devices</div>
              <div className="space-y-1.5 font-mono-j text-[11px]">
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Gamepads</span>
                  <span>{pads.length ? pads.length + ' connected' : 'none detected'}</span>
                </div>
                {pads.map((pad, index) => (
                  <div key={pad.id + index} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <div className="text-cyan-j">{pad.id}</div>
                    <div className="text-muted-foreground">{pad.buttons.length} buttons · {pad.axes.length} axes · mapping {pad.mapping || 'none'}</div>
                  </div>
                ))}
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Media devices</span>
                  <span>{deviceCounts.total ? Object.entries(deviceCounts.byKind).map(([kind, count]) => count + ' ' + kind.replace('input', '').replace('output', ' out')).join(', ') : 'none reported'}</span>
                </div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Web MIDI</span>
                  <span>{'requestMIDIAccess' in navigator ? 'available (needs permission)' : 'unavailable'}</span>
                </div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Bluetooth and USB</span>
                  <span>{['bluetooth' in navigator ? 'Bluetooth' : null, 'usb' in navigator ? 'USB' : null, 'hid' in navigator ? 'HID' : null].filter(Boolean).join(', ') || 'none'}</span>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Gamepads appear only after a button is pressed on them, which is a deliberate browser privacy rule rather than a fault. Device names stay hidden until you grant
                camera or microphone permission once — that is why an unprompted page sees anonymous, numbered devices.
              </p>
            </Panel>

            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Permission states</div>
              <div className="divide-y divide-border/40">
                {PERMISSIONS.map((name) => {
                  const state = report.perms[name];
                  return (
                    <div key={name} className="flex items-center justify-between gap-3 py-1.5 text-[11px]">
                      <span className="text-muted-foreground">{name}</span>
                      <span className={state === 'granted' ? 'font-mono-j text-emerald-400' : state === 'denied' ? 'font-mono-j text-rose-400' : 'font-mono-j text-muted-foreground'}>
                        {state || 'not queryable'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                “Prompt” simply means the browser will ask when the feature is actually used. A denied permission is remembered per origin until you clear site data, which is
                the usual reason a feature silently stops working.
              </p>
            </Panel>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Privacy signals this browser exposes</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {privacySignals.map((row) => (
                <Stat key={row.label} label={row.label} value={row.value} mono />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Two of these are deliberate opt-outs: Do Not Track and Global Privacy Control. Both are signals, not enforcement — a site is free to ignore them, and many do.
            </p>
          </Panel>

          <div className="grid gap-2 sm:grid-cols-4">
            <Pills
              items={[
                { label: 'Supported', value: totals.supported + '/' + totals.total },
                { label: 'Gamepads', value: String(pads.length) },
                { label: 'Devices', value: String(deviceCounts.total) },
              ]}
            />
          </div>

          <Panel>
            <p className="text-[11px] text-muted-foreground">
              Every probe runs on this device and none of the results are sent anywhere. An API being present is not the same as it being usable: a corporate proxy can break
              WebSockets, a locked-down profile can refuse screen capture, and hardware can support a codec the browser has disabled.
            </p>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}