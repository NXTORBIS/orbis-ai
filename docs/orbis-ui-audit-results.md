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
