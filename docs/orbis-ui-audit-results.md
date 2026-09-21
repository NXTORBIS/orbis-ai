# Orbis browser UI audit results (Phase 3, partial)

Method: own build launched with a temp profile and CDP `Page.captureScreenshot`. Screenshots live in the session scratch dir (`.../scratchpad/shots/`, files `<url>_<scheme>.png`). Views UI was NOT captured in this pass.

## WebUI surfaces captured (dark)
| Surface | File | Verdict | Notes |
|---|---|---|---|
| chrome://settings (+appearance, privacy, help, search) | chrome_settings_*_dark.png | Orbis (palette via colour system) | "Google services", "You and Google" labels remain (real Google features); sidebar logo was the Chrome glyph (fixed, patch 2). |
| chrome://settings/help | chrome_settings_help_dark.png | Orbis | Copyright line says "The Chromium Authors" (kept: attribution). |
| chrome://history | chrome_history_dark.png | mixed | Sync promo uses stock Google-coloured illustration and "Google may personalize" copy; page title "History" nearly invisible (low contrast) in dark. |
| chrome://version | chrome_version_dark.png | Orbis after fix | Was Chromium wordmark; now Orbis mark. UA string still says Chrome/154 (compat, intentional). |
| net error (DNS) | http_neterr_invalid__dark.png | Orbis after fix | Blue button/links now Orbis accent; sad-file pixel icon still stock. |
| downloads, bookmarks, extensions, flags, management, policy, apps, password-manager, tab-search, interstitials, profile-picker, orbis-newtab | *_dark.png / *_light.png | captured, NOT individually reviewed | see limits |

## Not done / not verified
- Light-scheme emulation does not switch WebUI (browser theme is dark), so light captures equal dark.
- No Views captures (toolbar, tabs, omnibox popup, menus, bubbles, dialogs), no PDF viewer, print preview, self-signed TLS interstitial, DPI sweep, forced-colors, perf numbers.
- Stages B (token-generated C++/CSS), C, most of D, F, G were not carried out in this pass.

## Changes made
- patches/chromium-orbis-ui-restyle-1.patch: Orbis wordmark PNGs (product_logo_name_22[_white], 100% and 200%).
- patches/chromium-orbis-ui-restyle-2.patch: `--google-blue-*` ramp in cr_shared_vars.css and interstitial_core.css remapped to Orbis accent tokens (single source for legacy blue consumers); Chrome glyph in chrome_logo_dark.svg replaced with Orbis ring; chrome://version uses current-channel-logo.


## Views 1 (native tab strip, toolbar, omnibox)

Method: my own spawned build (`scripts/orbis-views-shots.mjs`), profile pinned to dark or light through the `browser.theme.color_scheme2` pref, `--force-device-scale-factor` 1 and 1.5. Pictures are taken with `PrintWindow` of the browser's own windows (never the screen); the key input for the omnibox goes through `src/main/chromium/browserUi.ts`, which sends nothing unless the foreground window is the browser's own. Hover uses a real cursor move only after the topmost window at that point was verified to be this browser's. Files: `docs/views1-shots/views1_{dark,light}{100,150}.png` (tabs: pinned, group pill, audio, muted, loading, active), `..._hover.png` (hover tab with close button), `views1_popup_*` and `..._selected.png` (typed "exam", then two Down keys).

Target: the deleted Electron UI (`.browser-tab` 28px pill, radius 8, 13px, active = raised surface; group chip radius 6; `.b-icon` 32px hit targets, radius 8).

What changed (patch `patches/chromium-orbis-views-tabstrip.patch`; the token header is generated, not patched):
- Single token source: `orbis-ui/tokens.json` (added `surface-2/-3`, `radius.tab/control`) -> `scripts/build-orbis-ui.mjs` writes `orbis-tokens.css` (WebUI) and `orbis-ui/generated/orbis_tokens.h` (C++ constexpr, `orbis::dark|light::k*`, `orbis::size::k*`), copied to `ui/color/orbis_tokens.h` by `scripts/sync-orbis-panel.ps1` (called by the apply script). The old hard-coded `#0B0E14` navy palette in the colour mixer is gone; Views, WebUI popup and WebUI toolbar all read the same values, dark and light.
- Tabs: flat 28px pill (active tab no longer a folder-tab with extensions), radius from token, no divider bars, inactive = no fill, hover wash, active = raised surface plus a 2px accent bar under the pill.
- Toolbar: 32px hit targets, radius-8 rounded squares (were circles), muted glyphs, bright on hover, accent when pressed, disabled = 35% alpha (real disabled state visible on back/forward). The WebUI reload button had a stray opaque navy body background (the old palette): now transparent.
- Omnibox: rounded input radius 10 (token), 32px height, light = white input on the raised bar, dark = wash; focus ring accent; popup rows colour from the same tokens.

| Element | Verdict | Evidence |
|---|---|---|
| Tab shape/spacing/radius, active vs inactive (surface + accent bar), inactive subtle | Done, verified | views1_{dark,light}{100,150}.png |
| Hover state + close button on hover/active | Done, verified | views1_*_hover.png |
| Loading indicator (real throbber, accent), audio indicator (accent), muted tab, pinned tab (icon only), group pill (Chromium group colour, radius 6 token) | Done, verified | views1_*.png (tabs: pinned, Research group, audio, muted, loading) |
| New-tab button, tab-search button, window caption buttons coherent with the strip | Done, verified | views1_*.png |
| Overflow behaviour with 8 tabs in a narrow window | Sane (tabs shrink to icons, close hidden until hover/active) | views1_*100.png |
| Tab hover card | Colour tokened (popover surface); NOT captured (no way to hover long enough for the card through PrintWindow) | not verified |
| Back/forward/reload/stop, disabled states | Done, verified (stop not shown while idle; behaviour tests pass) | views1_*.png |
| Extension/action buttons, orb, profile chip, app menu | Recoloured by tokens; profile chip "Sign in to Orbis?" and the "Error" app-menu chip are pre-existing states of the test profile, not restyled beyond colour | views1_*.png |
| Omnibox container, focus ring, site-info chip, inside text | Done, verified | views1_popup_* |
| Suggestion popup: row layout, selected row (accent tint + accent bar + clear button), types distinguishable by icon and "Switch to this tab" chip | Done, verified; real predictions and Up/Down keyboard kept | views1_popup_*_selected.png |
| Token source for C++ and WebUI CSS | Done (one JSON), see above | scripts/build-orbis-ui.mjs |
| Font | Views uses Segoe UI (first installed family of the token stack). Inter Variable is a web font (OFL) and is not shipped into Views: not done | - |

Regression tests (serial): launch 4/4, browserManager 6/6, chromiumCapabilities 8/8, chromiumCapabilities2 11/11 pass. browserUi.test.ts: 3/11 pass here; the 8 failures are all "typed text / F12 did not reach the browser" and the same typing works in my own spawned window (verified by the popup shots and a direct check), so they look like foreground contention with other windows on this machine, not a UI regression, but that is not proven. Added a 450ms settle after ctrl+l in browserUi.ts (typing before focus lands was lost in one variant).

Not done: tab hover card capture, Inter in Views, tab title font size 13 (still Chromium's 12), other suggestion types (bookmark/navigation) captured only by icon design rather than screenshot, pixel-diff against the old Electron UI.

### Views 1, follow-up: browserUi test and menus

browserUi.test.ts: reproduced by hand (the same spawn, control service and capabilities, with and without devtools first): every step passes; `node --test` then gave 11/11 on four consecutive runs (three plain, one with ORBIS_UI_DEBUG). The earlier 3/11 runs were not reproducible afterwards; the browser process was healthy in them and the only code change in between was the 450ms settle after Ctrl+L in browserUi.ts, so I cannot prove the cause. The two theories named by the coordinator do not apply: the test opens an http page, not chrome://orbis-newtab, and the omnibox UI Automation element ("Address and search bar") reads correctly on the restyled build. A run on a machine where another window keeps taking the foreground will still fail with focus-refused, which is by design.

Menus (colours already come from the token palette through the Material "sys" ids, so no C++ change was needed): app menu, omnibox/page context menu (hover row, disabled Undo/Paste/Translate dimmed, separators, icons, submenu chevrons, zoom row) and the find bar, in dark and light at 100% and 150%: `docs/views1-shots/views1_menu_{appmenu,pagemenu,find}_{dark,light}{100,150}.png`. The black frame around menus in the pictures is a PrintWindow artefact of the menu's shadow window, not a UI defect.

Not done in this run (no screenshots, so not verified): tab context menu, link/image/selection context menus, profile/avatar popup and profile creation, downloads bubble, bookmark bubble, extension menu, site-information bubble, permission prompts, zoom bubble, fullscreen-exit bubble, tab hover card, tooltips, alert/confirm/beforeunload dialogs, toasts. They read the same colour ids, so they will follow the palette, but that is expectation, not evidence.


## Views 2 (every remaining native surface)

Method: `scripts/orbis-views2-shots.mjs` starts my own browser (dark/light profile, 100% and 150% scale), serves a local test site on 127.0.0.1:9445 (page with link/image/selection, slow/failing/small downloads, audio + canvas video, login form, beforeunload page, Spanish page) and drives each surface with real input through `BrowserUi` (foreground window and window under the cursor must both belong to that pid; UI Automation finds toolbar/menu elements; `clickElement`, `clickScreen`, `hoverAt`, `elements` are new). Pictures are `PrintWindow` of that process's own windows (`scripts/orbis-capture.ps1`, new `-Each` mode for windows outside the main one, e.g. picture-in-picture). All 4 configurations were captured in full: `docs/views2-shots/v2_<surface>_{dark,light}{100,150}.png` (about 190 files). The black frame around popups in the pictures is the PrintWindow artefact of layered windows, not a UI defect.

Result of the first pass: the Views 1 palette (Material "sys" colour ids) and the corner/elevation work already carried nearly every bubble, menu and dialog (rounded 12-14px surfaces, popover surface, accent default button, tonal secondary, accent toggles, accent progress). The defects that were real, and their fixes (patch `patches/chromium-orbis-views-bubbles.patch`, plus folds into the palette and tabstrip patches):

- Tooltips: square white-bordered black box. Now radius 6 (token `sm`), hairline outline from the palette, popover surface and text colours (`ui/views/corewm/tooltip_view_aura.cc`), translucent tooltip widget enabled on Windows so the corners are real (`tooltip_aura.cc`). Caveat: a tooltip window is not parented to the browser window, so it follows the OS light/dark setting, not the browser theme: with a light browser theme on a dark OS the tooltip stays dark (light100/150 pictures).
- Fullscreen "press Esc to exit" bubble: square slab `#282C32`. Now radius 10, Orbis popover surface `#101216`, key-cap radius 4 (`components/fullscreen_control`).
- Tab with a group colour outline had flared folder-tab feet (old border path). The outline now follows the flat pill (`horizontal_tab_style_views.cc`, tabstrip patch).
- Omnibox site chip on `chrome://` pages showed the stock Chrome logo; now the Orbis ring mark (`chrome_location_bar_model_delegate.cc`).
- Tooltip and fullscreen colours also added to the Orbis colour mixer (palette patch).

Per surface (file stem is `v2_<name>`; each exists for dark100/dark150/light100/light150 unless noted):

| Surface | File stem | Verdict | Notes |
|---|---|---|---|
| Tab context menu | tabctx | Done, verified | rounded, separators, disabled rows dimmed, shortcuts right-aligned |
| Page / link / image / selection context menus | pagectx, linkctx, imgctx, selctx | Done, verified | same menu style |
| Omnibox context menu | omniboxctx | Done, verified | focus ring on the omnibox visible |
| Profile / avatar popup | profile, profilebubble | Done, verified | Chromium's own account popup, "Your Orbis", no Orbis Chat link |
| Sign-in chip states | seen in many pictures ("Sign in to Orbis?" chip, then the avatar button) | Verified as rendered; the chip is the real Chromium promo chip and it is palette-tinted | nothing connected to Orbis Chat |
| Profile creation flow | profilepicker, profilecreate | NOT verified | `chrome://profile-picker/` opened in a tab is blank (it needs its own window); clicking "Add Orbis profile" opened no second window in 22 s. Not diagnosed |
| Downloads bubble: progress, completed, error (with Resume) | dlprogress, dldone, dlfail | Done, verified | accent progress bar, red error text, no change needed |
| Bookmark bubble | bookmarkbubble | Done, verified | accent Done, tonal Remove, focus ring on the name field |
| Bookmarks bar, folder menu, bookmark context menu | bookmarkfolder, bookmarkctx | Done, verified | |
| Extensions menu | extensions | Partly: the app-menu "Extensions" row and its submenu were opened; the toolbar puzzle button does not exist in this build (only the pinned Orbis action), so that menu could not be captured | |
| Site information bubble | siteinfo, siteinfoperm | Done, verified | connection, cookies, site settings; permission rows with accent toggles, Reset permissions (siteinfoperm uses http://localhost:9445 with stored permissions) |
| Permission prompts: location, camera+mic (live preview), notifications | permgeo, permcam, permnotif | Done, verified | origin, permission, Allow while visiting / Allow this time / Never allow. All three buttons are the same tonal style (Chromium's design); I did not make Allow the accent button |
| Find bar | findbar | Done, verified | count 1/1, prev/next, close |
| Zoom bubble | zoom | Done, verified | |
| Fullscreen-exit bubble | fullscreen | Fixed, verified | see above |
| Tab hover card | tabhover | Done, verified | |
| Tooltips | tooltip | Fixed, verified in dark; light browser theme on a dark OS stays dark (see caveat) | |
| alert / confirm / prompt / beforeunload dialogs | alert, confirm, prompt, beforeunload | Done, verified | accent default button with focus ring, tonal Cancel, scrim |
| Tab-search bubble | tabsearch | Done, verified | |
| Save-password bubble | savepw | Done, verified except the header illustration (stock blue/green artwork, not recoloured) | |
| Translate bubble | translate | NOT reachable: no translate bubble appeared on a lang="es" page (needs Google's translate service) | |
| Autofill address bubble | - | NOT captured (form page exists, save-address bubble not triggered) | |
| Media controls hub | media | Done, verified | title/artist, accent scrubber, Live Caption toggle |
| Picture-in-picture | pip, pipwin | Window captured (video plus origin label); its hover control bar was NOT captured | |
| Window frame: maximised, narrow (520px), short (330px) | frame_max, frame_narrow, frame_short | Done, verified | narrow shows the toolbar overflow chevron |
| Tab strip overflow (15 tabs) | taboverflow | Done, verified | tabs shrink to favicons; titles clip hard ("Oth") as stock |
| Tab group editor bubble and group context menu | groupeditor, groupctx | Done, verified | rename field, colour dots, menu rows. Grey group renders as a near-white chip in dark, which is Chromium's design; not changed |
| App menu | appmenu | Done, verified | |
| Keyboard focus ring | focusring_toolbar | Partly: omnibox focus ring (accent) and the dialog/bubble default-button and text-field rings are visible; a toolbar-button ring was not captured | |

Known, not caused by Orbis UI code: the "Error" chip on the app menu button is Chromium's extension-warning badge; the menu row it opens says "Extension error" and, on this machine, "New extension added (Adobe Acrobat ...)", i.e. Chrome's external-extension registration on this PC. I could not find which extension warning the first row refers to (the two component extensions load with their rulesets enabled, `chrome://extensions-internals` lists no warning text). Sign-in chip and "Error" chip both appear in every picture.

Regression tests (serial): launch 4/4, browserManager 6/6, chromiumCapabilities 8/8, chromiumCapabilities2 11/11, browserUi 11/11, service 5/5, agent 4/4 pass.

Tooling note: `src/main/chromium/browserUi.ts` now writes its PowerShell helper to a temp .ps1 file instead of `-EncodedCommand` (the script outgrew the 32K command-line limit).


## Views 3 (WebUI pages, native leftovers) - partial

Method: `scripts/orbis-views3-shots.mjs` (own spawned browser, temp profile with `browser.theme.color_scheme2` 1/2, CDP `Page.captureScreenshot` + `Emulation.setDeviceMetricsOverride`), `scripts/orbis-views3-flow.mjs` (profile menu via real input), `scripts/orbis-views3-fresh.mjs` (fresh profile), plus `orbis-views2-shots.mjs --only ... --tag v3`. Screenshots in `docs/views3-shots/`. Light really applies on the WebUI pages that read the colour system (history, settings, downloads, extensions); the profile picker, version page and net-error pages use `prefers-color-scheme` (OS), so they follow the OS scheme, not the browser pref.

Patches: `chromium-orbis-native-leftovers.patch`, `chromium-orbis-webui-pages.patch`, folded: `chromium-orbis-component-extension.patch`, `chromium-orbis-signin-style.patch`. All pass `git apply --reverse --check`.

| Surface | Status | Evidence / notes |
|---|---|---|
| Permission prompt (geolocation) | Done, verified (dark 1x) | v3_permgeo_dark100: "Allow" accent, others tonal. Cause was explicit `kTonal` on both buttons. Light not captured. |
| Extensions (puzzle) button | Explained, verified | Not hidden by a patch: stock 154 hides the container while the profile has no user extensions. Appears with one loaded (v3ext_appmenu_dark100). I also made the WebUI toolbar keep the native extensions container (`IsWebUIExtensionsContainerEnabled`). Restyle is by palette only. |
| External extensions / chip | Done, verified on a fresh profile | Windows registry provider no longer registered. The remaining "Error" chip on a fresh profile was an extension warning about the built-in (component) ad blocker; warnings for component extensions no longer raise the badge (v3_fresh2_toolbar: no chip). Root warning type not identified. |
| Profile creation (menu > Add Orbis profile) | Done, verified | Was crashing the browser (DCHECK: blocking file call in ComponentLoader on the UI thread for a second profile). Now creates `Profile 1`, opens a window and the Orbis-styled customization dialog (v3_flow_after_add2-w0/w1). Switch and delete NOT exercised. chrome://profile-picker in a plain tab renders; its Add button cannot work in a tab (needs the picker window). Profiles use separate directories; sign-in is unavailable (no OAuth client). |
| chrome://profile-picker | Done, dark and light 1x | Stock gradient replaced by Canvas surface; text follows OS scheme. |
| chrome://history | Done, dark and light 1x | Orbis illustration, Google copy removed (history_strings + generated_resources), toolbar title uses primary text colour. Sync promo string in generated_resources also neutralised. |
| chrome://settings, /help, /appearance, /search, /privacy | Captured dark and light; About sidebar icon replaced by Orbis ring (settings icon set); other subpages not individually reviewed | "You and Google", "Google services" kept (real Google features). |
| chrome://version | Orbis colours (both schemes via OS media query), Orbis mark | Copyright line "The Chromium Authors" and UA "Chrome/154" kept. |
| Error page (DNS/unsafe port) | Done, light 1x | Orbis ring-exclamation replaces the pixel icon; copy is stock. Offline, SSL, connection refused not captured. |
| chrome://downloads, bookmarks, extensions, flags, policy, password-manager, certificate-manager, management, apps, tab-search, interstitial debug page | Captured (dark and light where in log), only downloads/extensions reviewed | Extensions page still shows the Chrome Web Store icon (real store). Interstitials: only the "debug pages disabled" page captured; real SSL/phishing interstitials NOT captured. |
| PDF viewer | Captured dark 1x | Works (thumbnails, zoom, fit, download, print); toolbar is stock grey, thumbnail selection accent; not restyled. |
| Print preview, first-run/welcome, crash, side panels, PiP control bar, toolbar focus ring | PiP and focus ring captured (v3_pipwin..., v3_focusring_toolbar) but only the focus ring viewed (accent ring on the omnibox looks right); print preview, first run, side panels NOT verified | chrome://crash hung my capture script (renderer crash), so it was skipped. |
| 2x and 390px | Only settings and history at 2x/390 dark were shot, not reviewed | |
| Regression tests (serial) | launch 4, browserManager 6, chromiumCapabilities 8, chromiumCapabilities2 11, browserUi 11, service 5, agent 4, orbisSearchPage 14: all pass | |

Not done in this pass: the full dark/light x 1x/2x x narrow/wide sweep, settings subpage-by-subpage layout work, generated CSS from tokens for WebUI shared styles (shared foundations only got the toolbar colour and About icon), interstitials, print preview, first run, side panels, switching/deleting profiles, PDF restyle.

## Views 4 (final pass) - partial

Status: this pass was NOT completed. Only item H and a branding probe were done.

- (H) Regression: launch(4), browserManager(6), chromiumCapabilities(8), chromiumCapabilities2(11), browserUi(11), service(5), agent(4), orbisSearchPage(14), chromiumRecorder(2), chromiumControl(8): all pass, 0 fail. `npm test` non-Chromium parts not run.
- (C) Probe of out\Default\chrome.exe VERSIONINFO: FileDescription=Orbis, ProductName=Orbis, InternalName=chrome_exe, OriginalFilename=chrome.exe, CompanyName="The Chromium Authors" (remaining leak; CompanyName still needs a branding change).
- Not done: A (remaining pages review), B (token-generated shared CSS/Inter), rest of C, D (a11y/DPI), E (perf numbers), F (shortcut verification), G (installer build/install smoke).

## Branding sweep (2026-09-21)
See `docs/orbis-branding-audit.md`. VERSIONINFO CompanyName leak (item C above) fixed: CompanyName=Orbis. Settings "You and Google" -> "You and sign-in". About, version, settings, flags, extensions, history, error, password manager, profile picker scanned: remaining hits are real Google services, attribution, or internal/dev pages (justified in that doc). Screenshots: `docs/branding-audit-shots/`.
