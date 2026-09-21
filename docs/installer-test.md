# Installer test (Orbis 0.3.0, Windows NSIS)

Latest run: 2026-09-21 (second run, after the rail/panel work). Chromium 154.0.8037.44 component build from C:/chromium/src/out/Default.

## Second run (this build: Orbis panel rail, customize-chrome mock, updated palette)
- `npm run build`, `npm run stage:browser`, `npx electron-builder --win`: dist/Orbis-Setup-0.3.0.exe = 549 MB.
- Silent install `/S /D=C:\chromium\orbis-install-test`: exit 0, 2m06s.
- Smoke of the installed Orbis.exe (userData C:/chromium/orbis-install-smoke, CDP port on the Electron shell only): chromiumOpen('how do tides work') -> ok:true, 14.5 s from app start (includes the one-time sandbox ACL grant). Chromium child runs with --remote-debugging-pipe (no --remote-debugging-port). Window title "how do tides work · Orbis Search - Orbis". ALL APPLICATION PACKAGES and ALL RESTRICTED APPLICATION PACKAGES (RX) were on chrome.exe afterwards: granted automatically.
- Ctrl+Shift+Y (sent after checking the foreground window belonged to that browser pid) opened the built-in panel: it shows "Connected" and the whole sidebar rail (Tabs ... Secrets). Screenshots (PrintWindow of that pid only): docs/installer-test-window.png, docs/installer-test-panel.png.
- Silent uninstall: exit 0, install folder gone, no Orbis process left; smoke data dir removed.
- Known: the browser's command line carries the helper token (--orbis-helper-token=...) as a process argument, readable by other processes of the same Windows user. Not changed here.

## First run (earlier 0.3.0 build)
Date 2026-09-21. Chromium 154.0.8037.44 component build from C:/chromium/src/out/Default (no build was running).

## Steps and results
1. `npm run stage:browser` (9.6 s): resources/chromium = 1623 MB, 547 DLLs (component build), includes 154.0.8037.44.manifest, locales, PrivacySandboxAttestationsPreloaded, MEIPreload, resources/orbis_extension. No stage script change was needed by this test.
2. `npm run build` then `npx electron-builder --win` (about 8 min total): dist/Orbis-Setup-0.3.0.exe = 532 MB (older 0.1/0.2 installers were 135 MB). resources/chromium exists once (dist/win-unpacked/resources/chromium), not double-copied. dist/ and resources/chromium/ are git-ignored.
3. Silent install: `Orbis-Setup-0.3.0.exe /S /D=C:\chromium\orbis-install-test` (per-user, perMachine=false): exit 0, 2m31s, 2252 MB on disk.
4. Smoke of installed Orbis.exe (userData C:/chromium/orbis-install-smoke, CDP port on the Electron shell only):
   - chromiumOpen('how do tides work') -> ok:true. Chromium child has --remote-debugging-pipe, no --remote-debugging-port. Window title "how do tides work Â· Orbis Search - Orbis".
   - chromiumOpen('example.org') -> ok:true.
   - ACL: right after install chrome.exe had no APPLICATION PACKAGES entry; after first launch icacls shows ALL APPLICATION PACKAGES and ALL RESTRICTED APPLICATION PACKAGES (RX): granted automatically.
   - Time to window: first launch 16.1 s from app start (includes the one-time ACL grant over the 1.6 GB tree); second launch 3.1 s.
   - Screenshot: docs/installer-test-window.png (PrintWindow of that pid only). Orbis Search results render correctly in dark theme. Note: the toolbar still shows a "Sign in to Orbis?" chip although sign-in is meant to be removed (not touched here).
5. Silent uninstall `Uninstall Orbis.exe /S`: exit 0, install folder removed. Smoke data dir and temp script removed; no Orbis/chrome processes left.

## Problems
- Installer size (532 MB, 2.2 GB installed) comes from the component build's many DLLs; a non-component release build would shrink it greatly. Not changed.
- First launch is slow (16 s) due to the one-time ACL grant.

