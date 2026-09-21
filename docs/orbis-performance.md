# Orbis browser performance (Views 6, measured 2026-09-21)

Build: Chromium 154.0.8037.44 with the Orbis patch stack, `out\Default`, Windows 11, one machine.
Method: `scripts/orbis-views6-perf.mjs 5` - median of 5 runs, every run a fresh temp profile and a fresh browser process (own pid only), CDP by port, OS-level
key input through `BrowserUi` (foreground of the own pid verified before each key). No other Chromium was running during the runs.

## Results (median of 5)

| Metric | Median | Min | Max | Notes |
|---|---|---|---|---|
| spawn -> first tab commit | 485.5 ms | 474.8 | 501.2 | document `timeOrigin + responseStart` of the first tab minus the moment `spawn()` was called; the closest available equivalent of "first `frameNavigated`" (CDP is not attached before the process exists). Earlier identical run: 517.6 ms. |
| new tab via `Target.createTarget` (chrome://newtab/, rewritten to chrome://orbis-newtab) -> first contentful paint | 388.4 ms | 387.4 | 404.2 | first measurement set (5 runs). In the second set the paint never fired inside the 5 s wait for the 5 runs (the tab is created in the background, so paint is throttled): reported as n/a there, not averaged in. |
| new tab via Ctrl+T (OS key) -> first contentful paint | 199.3 ms | 190.2 | 203.5 | includes `BrowserUi`'s foreground check and one `SendInput`; the first set gave 196.9 ms. The tab is foreground, so this is the more realistic number. |
| omnibox popup: typing "orb" -> suggestion rows readable through UI Automation | 345 ms | 338 | 355 | upper bound: each UIA poll itself takes ~150-250 ms, so the true popup latency is lower; the first set gave 358 ms (range 327-634). |
| Orbis side panel: Ctrl+Shift+Y -> panel first contentful paint (first open in the process) | 348 ms | 281.6 | 390.9 | includes creating the WebContents and loading chrome://orbis |
| browser process private working set, 1 tab, 30-60 s after launch | 89.1 MB | 88.4 | 90.7 | `Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate` |
| browser process private working set, 10 tabs, after 8 s + 30 s | 120.0 MB | 117.7 | 133.7 | 10 tabs = 1 + NTP + Orbis panel (opened once) + data: pages; the panel's WebContents is kept after it is closed |
| whole process tree private working set, 1 tab | 418.2 MB | 416.3 | 434.7 | all child processes summed (GPU, network, renderers, ...) |
| whole process tree private working set, 10 tabs | 886.4 MB | 882.6 | 909.6 | |
| browser process CPU, first 30 s after launch (1 tab) | 38.6 % of one core | 37.2 | 42.3 | startup work (component/filter-list/extension loading) is still running; NOT idle |
| browser process CPU, 30-60 s window after launch (1 tab) | 0.3 % | 0.2 | 0.3 | the idle number |
| browser process CPU, 10 tabs, the 30 s starting 8 s after creating the tabs | 26.1 % | 21.5 | 30.1 | tab creation is still settling; see next row |
| browser process CPU, 10 tabs, steady state (single run, windows of 10 s from 30 s after creating the tabs) | 0.3-1.4 % | | | one run only (a separate probe, not part of the 5-run script): 122 % and 68 % in the first two 10 s windows, then 1.4, 1.1, 0.9, 1.2, 0.9, 0.3 |

## Honest limits

- There is no baseline from before the Views restyle, so nothing here says whether the restyle made anything faster or slower; these are absolute numbers for this build on this machine.
  (A comparison would need the pre-restyle build, which was not kept.)
- One machine, one build, one screen; timings are wall-clock across processes (the page's `timeOrigin` against the harness clock), good to a few ms.
- "After 30 s idle" for CPU is only meaningful once startup work is done: the first 30 s after launch cost ~39 % of a core in the browser process, the next 30 s 0.3 %.
  Both are shown instead of picking the flattering one.
- The 10-tab memory includes the cached Orbis panel; without opening the panel the figure would be a little lower (not measured separately).
- Stock-Chromium comparison numbers were not measured.
