import { useEffect, useMemo, useRef, useState } from 'react';
import { BatteryCharging, Play, Square } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { Hero, Pills, Ring, Spark } from '../kit/premium';
import { Panel, Seg, Stat, Unsupported } from '../shared';

const LOAD_SECONDS = [
  { value: 20, label: '20 seconds' },
  { value: 40, label: '40 seconds' },
  { value: 60, label: '60 seconds' },
];

const sampleInterval = 15000;

const fmtMinutes = (seconds) => {
  if (seconds == null || !isFinite(seconds) || seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? hours + ' h ' + minutes + ' min' : minutes + ' min';
};

const burnChunk = (ms) => {
  const until = performance.now() + ms;
  let x = 1;
  while (performance.now() < until) { x = (x * 16807) % 2147483647; }
  return x;
};

export default function BatteryAudit() {
  const [battery, setBattery] = useState(null);
  const [supported, setSupported] = useState(true);
  const [samples, setSamples] = useState([]);
  const [testSeconds, setTestSeconds] = useState(40);
  const [testing, setTesting] = useState(false);
  const [loadResult, setLoadResult] = useState(null);
  const testRef = useRef(false);

  useEffect(() => {
    if (!navigator.getBattery) {
      setSupported(false);
      return undefined;
    }
    let manager = null;
    const read = (event) => {
      const source = event?.target || manager;
      if (!source) return;
      setBattery({
        level: typeof source.level === 'number' ? source.level : null,
        charging: !!source.charging,
        chargingTime: source.chargingTime,
        dischargingTime: source.dischargingTime,
      });
    };
    navigator.getBattery().then((managerInstance) => {
      manager = managerInstance;
      read({ target: manager });
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((name) => {
        manager.addEventListener(name, read);
      });
    }).catch(() => setSupported(false));
    return () => {
      if (!manager) return;
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((name) => {
        manager.removeEventListener(name, read);
      });
    };
  }, []);

  // Keep our own samples, because the raw API gives a state, not a rate.
  useEffect(() => {
    if (!supported) return undefined;
    const push = () => {
      if (navigator.getBattery) {
        navigator.getBattery().then((manager) => setSamples((current) => {
          const next = [...current, { t: Date.now(), level: Math.round(manager.level * 100), charging: manager.charging }];
          return next.slice(-240);
        })).catch(() => {});
      }
    };
    push();
    const id = setInterval(push, sampleInterval);
    return () => clearInterval(id);
  }, [supported]);

  const rate = useMemo(() => {
    if (samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const hours = (last.t - first.t) / 3600000;
    if (hours < 0.04) return null;
    const drop = first.level - last.level;
    if (drop <= 0) return null;
    return { perHour: drop / hours, hours, drop };
  }, [samples]);

  const startLoadTest = async () => {
    testRef.current = true;
    setLoadResult(null);
    setTesting(true);
    let manager = null;
    try { manager = await navigator.getBattery(); } catch { manager = null; }
    const startLevel = manager ? Math.round(manager.level * 100) : null;
    const startCharging = manager ? manager.charging : null;
    const seconds = testSeconds;
    const started = performance.now();
    while (testRef.current && performance.now() - started < seconds * 1000) {
      burnChunk(40);
      // Hand the thread back between chunks so the page stays alive.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const elapsed = (performance.now() - started) / 1000;
    const endLevel = manager ? Math.round(manager.level * 100) : null;
    setTesting(false);
    setLoadResult({
      seconds: elapsed,
      startLevel,
      endLevel,
      charging: startCharging,
      drop: startLevel != null && endLevel != null ? startLevel - endLevel : null,
      perHour: startLevel != null && endLevel != null && endLevel < startLevel ? ((startLevel - endLevel) / elapsed) * 3600 : null,
    });
  };

  const stopLoadTest = () => { testRef.current = false; };

  const context = useMemo(() => {
    const conn = navigator.connection || {};
    return [
      { label: 'Charging', value: battery?.charging ? 'yes' : 'no' },
      { label: 'API says left', value: battery?.charging ? '—' : fmtMinutes(battery?.dischargingTime) },
      { label: 'Save data', value: conn.saveData ? 'on' : 'off' },
      { label: 'Connection', value: conn.effectiveType ? String(conn.effectiveType).toUpperCase() : 'not exposed' },
      { label: 'Reduced motion', value: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'requested' : 'not requested' },
      { label: 'Tab visibility', value: document.visibilityState },
      { label: 'CPU threads', value: navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'not exposed' },
    ];
  }, [battery]);

  const report = [
    supported ? 'Battery level ' + (battery?.level != null ? battery.level + '%' : 'unknown') + (battery?.charging ? ' (charging)' : '') : 'Battery Status API is not available in this browser.',
    rate ? 'Measured discharge ' + rate.perHour.toFixed(1) + ' %/hour from ' + samples.length + ' samples over ' + (rate.hours * 60).toFixed(0) + ' minutes' : 'Discharge rate still collecting samples',
    rate ? 'Projected runtime at this drain ' + (battery?.level != null ? (battery.level / rate.perHour).toFixed(1) : '—') + ' hours' : '',
    loadResult ? 'Load test ' + loadResult.seconds.toFixed(0) + ' s: ' + (loadResult.startLevel ?? '—') + '% → ' + (loadResult.endLevel ?? '—') + '%' + (loadResult.perHour ? ' (' + loadResult.perHour.toFixed(1) + ' %/hour under load)' : ' (no measurable change)') : '',
    '',
    ...context.map((row) => row.label + ': ' + row.value),
  ].filter(Boolean).join('\n');

  return (
    <ToolShell
      toolId="battery-status"
      icon={BatteryCharging}
      title="Battery & Power Audit"
      desc="Level, charge state and the real discharge rate from your own samples, plus a CPU drain test and a look at what this page is doing to your battery."
      state={{ testSeconds }}
      onRestore={(restored) => { if (restored.testSeconds) setTestSeconds(Number(restored.testSeconds)); }}
      exportText={report}
      exportName="battery-audit.txt"
    >
      {!supported && (
        <Unsupported msg="This browser does not expose the Battery Status API. Firefox and Safari hide it deliberately — it is a strong tracking signal — so these readings are only available in Chromium-based browsers." />
      )}

      {supported && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.3fr]">
            <Hero
              label="Charge level"
              value={battery?.level != null ? battery.level : '—'}
              unit="%"
              tone={battery?.level == null ? 'cyan' : battery.level > 50 ? 'emerald' : battery.level > 20 ? 'amber' : 'rose'}
              sub={battery ? (battery.charging ? 'on power' : 'running on battery') : 'reading the battery…'}
            />
            <Ring
              value={battery?.level ?? 0}
              max={100}
              tone={battery?.charging ? 'emerald' : 'cyan'}
              label={battery?.charging ? 'Charging' : 'Discharging'}
              sub={battery?.charging && battery?.chargingTime ? 'full in ' + fmtMinutes(battery.chargingTime) : 'sampling every 15 seconds'}
            />
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Measured drain" value={rate ? rate.perHour.toFixed(1) + ' %/h' : 'collecting'} mono sub={rate ? 'over ' + (rate.hours * 60).toFixed(0) + ' minutes' : 'needs a few samples'} />
              <Stat label="Projected runtime" value={rate && battery?.level != null ? (battery.level / rate.perHour).toFixed(1) + ' h' : '—'} mono sub="at the drain measured here" />
              <Stat label="API estimate" value={battery?.charging ? 'charging' : fmtMinutes(battery?.dischargingTime)} mono sub="what the system reports" />
              <Stat label="Samples held" value={String(samples.length)} mono sub="kept in memory only" />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">Charge level over this session</span>
              <span className="text-[11px] text-muted-foreground">{samples.length} samples, newest on the right</span>
            </div>
            {samples.length > 1 ? (
              <Spark data={samples.map((s) => s.level)} height={52} tone="emerald" />
            ) : (
              <p className="text-[11px] text-muted-foreground">Collecting. Leave the tab open for a few minutes and the trace appears — a battery meter moves in one-percent steps, so a short window shows a staircase, not a slope.</p>
            )}
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">Drain test under load</span>
              <span className="text-[11px] text-muted-foreground">Busy CPU work in short chunks, so the page stays responsive</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={testing ? stopLoadTest : startLoadTest} disabled={false} className="gap-1.5">
                {testing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {testing ? 'Stop the test' : 'Run the drain test'}
              </Button>
              <Seg value={testSeconds} onChange={(value) => setTestSeconds(Number(value))} options={LOAD_SECONDS} />
            </div>
            {loadResult && (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Stat label="Level before" value={loadResult.startLevel != null ? loadResult.startLevel + '%' : '—'} mono sub={loadResult.charging ? 'on power at the time' : 'on battery'} />
                <Stat label="Level after" value={loadResult.endLevel != null ? loadResult.endLevel + '%' : '—'} mono sub={loadResult.seconds.toFixed(0) + ' seconds under load'} />
                <Stat label="Extrapolated" value={loadResult.perHour ? loadResult.perHour.toFixed(1) + ' %/h' : 'no change seen'} mono sub="if the load were constant" />
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              A battery meter reports whole percent, and a healthy laptop under load may not fall a full percent in a minute — so "no change seen" is a normal result, not a
              failure. On a phone, or with a longer test, the drop becomes visible. Percent-per-hour extrapolated from a single step is rough: one percent either way is a
              large error.
            </p>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Power context on this device</div>
              <div className="divide-y divide-border/40">
                {context.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 py-1.5 text-[11px]">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-mono-j">{row.value}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">What actually drains a battery</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· The screen is usually the largest draw and no web API can read or dim it. Brightness, not code, is the first lever.</p>
                <p>· Animation frames keep the GPU awake. A page that animates while nobody is looking — a background tab running a loop — burns power for nothing.</p>
                <p>· Location and the microphone are costly: continuous GPS polling is among the heaviest things a page can ask for.</p>
                <p>· A screen wake lock stops the display sleeping, which is a deliberate, large, continuous cost.</p>
                <p>· WebGL scenes and video decoding keep the GPU at a high clock even when the picture is static.</p>
                <p>· Data saver mode and a slow connection mean the radio stays busy longer per byte, which shows up as heat and drain rather than speed.</p>
              </div>
              <div className="mt-3">
                <Pills
                  items={[
                    { label: 'Level', value: battery?.level != null ? battery.level + '%' : '—' },
                    { label: 'State', value: battery?.charging ? 'charging' : 'battery' },
                    { label: 'Drain', value: rate ? rate.perHour.toFixed(1) + ' %/h' : 'collecting' },
                  ]}
                />
              </div>
            </Panel>
          </div>

          <Panel>
            <p className="text-[11px] text-muted-foreground">
              The charge level is a tracking signal as well as a status: a combination of level, charge state and timing helps distinguish one device from another. It is
              one of the reasons Firefox and Safari removed the API entirely, and why this app never sends these readings anywhere — they stay in this tab.
            </p>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}