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
