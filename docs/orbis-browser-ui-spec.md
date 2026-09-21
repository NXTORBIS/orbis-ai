# Orbis browser UI redesign: master specification (from the user, 2026-09-20)

Scope: the Orbis browser (real Chromium underneath). Not Orbis Chat's UI, Orion's model behaviour, Orion's shortcuts, Chat auth or data.
Shared browser components are redesigned consistently without breaking their other consumers. The result must feel like ONE premium,
futuristic, calm, minimal Orbis browser (browser + AI + intelligence + productivity + privacy), not stock Chromium with a new toolbar and
not a SaaS dashboard. Avoid excess glass, neon, glow, gradients, shadows, borders, cards, animation, rounded containers, decoration.

## Absolute rules
- NO functional regression. Inspect first (existing browser, Chromium integration, Browser Control Layer, state, components, settings, profiles,
  browser sign-in, shortcuts, automation, Orion integration, personalization, widgets, workspaces, panels, security controls, ad blocking,
  downloads/history/bookmarks/extensions, layout modes), then redesign presentation only.
- Never: delete working functionality; replace real Chromium behaviour with mocks or UI-only state; fake buttons/menus/accounts/downloads/tabs/
  sign-in/settings/extension states; placeholder controls; disconnected toggles; a second address bar, tab system, browser state, auth, download
  manager, bookmark or history system. Every visible control connects to the real implementation. If backend state does not exist, the UI says
  it is unavailable.
- Browser sign-in stays Chromium's own and completely separate from Orbis Chat/Orion (no token/credential sharing, never shown as each other).
- Profiles stay isolated (browser state, tabs, cookies, history, bookmarks, downloads, settings, personalization, extensions, sign-in, Orion-local state).
- Existing shortcuts stay authoritative (Enter navigate; Ctrl+Enter Orion answer inside Orbis; Shift+Enter open in the system default browser).
- The new tab page is the real Orbis page from the first paint (never Google first). Search results the browser shows are Orbis's own results UI
  with real results/citations; explicit navigation to Google keeps working. No Google/Chrome/Electron branding where Orbis is represented.
- Chromium omnibox, predictions, history/bookmark suggestions and keyboard behaviour are the real ones, presented in the Orbis visual system.

## Design system (one, centralized, tokens only; no scattered values)
Typography (families, sizes, weights, tracking, line height, rendering; roles: heading/body/caption/label/button/tab/address/menu/dialog/error/helper),
spacing scale, radius scale (buttons, inputs, tabs, popups, menus, dialogs, panels, cards, widgets), surfaces (browser bg, toolbar, tab strip, active
tab, address bar, popup, menu, dialog, sidebar, panel, widget, settings, overlay), borders (width/opacity/dividers/focus/active/error/security),
elevation levels 0-4, one icon family (stroke/weight/size/states; accessible names + tooltips), motion (durations, easing, enter/exit, hover/press/
focus; normal + reduced), one button system (primary, secondary, tertiary, ghost, icon, destructive, AI; states normal/hover/pressed/focus/disabled/
loading), inputs (search, URL, text, password, number, select, date/time, file, secret; labels, validation), one tooltip system, one menu
architecture, one popup system (opens from trigger, positioned inside viewport, Escape, focus, keyboard, no orphans), notifications/toasts
(success/info/warning/error/progress/browser/download/AI/security; real events only), loading (skeleton/progress/streaming; never fake progress),
errors (what happened / what it affects / what to do), empty states (useful, short). Dark + light from the same system. Compatible with the existing
customization (accent, background, transparency, blur, surface opacity, radius, density, animation) and never overwrites user configuration.

## Surfaces to redesign (all of them)
Shell/frame/window controls/drag regions; tab strip and tabs (favicon, title, real loading, real audio/mute, pinned, close, new tab, drag, reorder,
overflow/scroll, hover, active state not by colour alone, compact sizing that keeps favicon/close/active visible, tab groups: create, rename, colour,
add/remove, collapse, move, reorder, menu); navigation (back/forward/reload/stop with real state); the single address/search bar and omnibox
(all states: empty, focused, typing, URL, search, loading, secure, insecure, local, error, AI query) and the prediction dropdown (icon, title,
secondary, destination, types distinguishable, keyboard, selected clarity); site information/security; main menu (progressive disclosure), page/tab/
group/address/link/image/selection/extension/download/bookmark menus; account/profile button + popup (current profile, avatar, name, real sign-in
state, switch/create/manage/settings); downloads, bookmarks, history, reading list, extensions (button, popup, manager, install flow, permissions,
enable/disable/remove/options/toolbar placement); permission prompts (camera, mic, location, notifications, clipboard, Bluetooth, USB, serial, HID,
MIDI, files; site, permission, reason, allow/block/temporary); security surfaces (HTTPS, certificates, dangerous downloads, phishing/malware warnings);
privacy UI (tracking protection, ad blocking, cookies, site data, private browsing without over-claiming); find; zoom; PDF chrome; print/save/page
actions; media controls/PiP; fullscreen indicators; settings (all sections, search, deep links, progressive disclosure, nothing removed); PWA/web app UI;
drag and drop (tabs, groups, bookmarks, files, widgets, sidebar items); DevTools integration surroundings only.

## Orbis capabilities in the browser (presentation only, real state)
Sidebar (the existing architecture, no second sidebar; header, items, groups, expand/collapse, pin, reorder, compact/expanded/icon-only, resize),
Orion browser assistant (model selection, Auto Mode showing the chosen model, vision, image generation, browser context, research, citations,
automation, voice, streaming, multi-turn), Orbis search results (source/favicon, title, URL, description, metadata, actions: open, new tab, copy link,
save, bookmark, Ask Orion, send to Whiteboard), research surfaces (progress, sources, claims, citations, save, Whiteboard), automation UI (task, step,
progress, verification, waiting, confirmation, success/failure, retry, pause/resume/stop; no chain-of-thought), workflows UI (steps, dependencies,
variables, conditions, iterations, state, verification, recovery, pause/resume/stop, confirmation; on the existing Browser Control Layer), widgets,
personalization (themes, wallpapers, layouts, presets, density, animation, accessibility), workspaces, Galaxy/Memory/Skills/Knowledge/Projects (real
data only), Whiteboard, clipboard (sensitive values protected), ad blocking, tracking protection, CAPTCHA assistance.

## Quality bars
Accessibility (keyboard, focus, screen reader names/descriptions, tab order, high contrast, reduced motion, larger text, zoom, focus indicators, not
colour alone). Responsive across the real layout modes (adapt, do not just scale; keep tabs, address/search, profile access, primary navigation).
DPI 100-200% and multi-monitor/mixed-DPI, window resize extremes, no clipping/overlap/unreachable menus. Performance: no expensive blur/shadows,
event-driven, lazy, virtualized long lists, cleanup on close; measure before/after (startup, new tab, tab switch, omnibox, popups, menus, settings,
navigation, scrolling, memory/CPU/GPU). Security: never expose passwords, keys, tokens, cookies, secrets, private-profile or private-browsing data.
Resilience: a UI component failure never crashes or breaks browser functionality; offline UI still works; multi-window and multi-profile correctness;
restart/crash restore of theme, profile, tabs, layout, sidebar, sign-in state; safe migration of visual settings.
Process: audit -> design system -> shared components -> shell -> tabs -> address bar -> menus -> popups -> profiles -> settings -> panels -> Orion
UI -> results -> automation/workflows -> advanced features -> accessibility -> responsive -> regression; checkpoints after each stage; final visual,
interaction, accessibility, performance, security and functional regression pass, and a polish pass (alignment, spacing, type, icons, contrast,
hierarchy, motion, density). Every existing feature is traced: existing feature -> implementation -> old UI -> new Orbis UI -> same functionality ->
regression test. No old UI left scattered.

Final architecture: real Chromium (tabs, navigation, omnibox, history, bookmarks, downloads, extensions, permissions, profiles, sign-in, media, PDF,
Web APIs, security, state) -> Orbis browser layer (Browser Control Layer, Orion, research, automation, workflows, personalization, widgets, workspaces,
Galaxy, memory, skills, whiteboard, privacy, security) -> one Orbis design system on every browser UI surface.
