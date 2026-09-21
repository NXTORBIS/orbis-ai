# Orbis branding audit (sweep, Chromium 154.0.8037.44)

Patch: `patches/chromium-orbis-branding-sweep.patch` (on top of the earlier branding patch). Scanner: `scripts/orbis-branding-scan.mjs` (fresh profile per page, CDP text walk through shadow roots, screenshots in `docs/branding-audit-shots/`, raw results in `scan.json`).

## Changed in this sweep
- chrome.exe VERSIONINFO: CompanyName `The Chromium Authors` -> `Orbis` (BRANDING COMPANY_FULLNAME/SHORTNAME). Verified: CompanyName/FileDescription/ProductName = Orbis.
- About pages (chrome://version) company string -> Orbis.
- Settings sidebar and page title "You and Google" -> "You and sign-in".
- chrome://flags header: "cool new Chrome features" -> "cool new features".
- Windows file-type descriptions "Chromium HTML/PDF Document" -> "Orbis ...".
- chromium_doc.ico, chromium_pdf.ico, app_list.ico now the Orbis icon (chromium.ico, the exe/window icon, was already Orbis).
- stage-chromium.mjs ships only locales/en-US.pak (the app has no UI-language setting; searched src for i18n/locale settings, only speech-recognition `language: 'en'` exists).

## Intentionally kept
| Item | Why |
|---|---|
| `Chrome/154...` in User-Agent, `Chromium` brand in userAgentData | web compatibility |
| "Copyright 2026 The Chromium Authors" (VERSIONINFO LegalCopyright, chrome://version, About, credits) and the "Chromium open source project" link on About | legal attribution |
| VERSIONINFO LegalCopyright shows raw `@LASTCHANGE_YEAR@` | pre-existing placeholder; not a brand leak, not changed |
| InternalName `chrome_exe`, OriginalFilename `chrome.exe`, install path/user-data folder name "Chromium", ProgID prefixes | renaming breaks profiles, updates and file associations |
| Google Translate, Google search engine entry, Google Account/Password Manager/Safe Browsing/Wallet/Sync text, "Sync and Google services" | the feature really is that Google service |
| Chrome Web Store, Chrome Root Store (certificate manager) | real product names |
| chrome://flags descriptions, chrome://policy ("Chrome Policies", policy names), chrome:// scheme and URLs | developer/enterprise pages; internal names |
| Non-English locales | not shipped after staging; en-US only |
| "Sign in to Orbis?" chip | already Orbis; sign-in itself unavailable (no OAuth client) |

## Not verifiable / open
- chrome://sync-confirmation, profile-customization, feedback, managed-user-profile-notice, history-sync-optin do not render in a plain tab (need their dialog host): not scanned.
- Windows toast/tray/taskbar/Jump List were not exercised at runtime; they derive from IDS_PRODUCT_NAME / the exe icon (both Orbis). Taskbar icon not captured separately (PrintWindow shows the title-bar tab icon and Orbis app menu: window.png, menu-w0.png).
- Extension warning "Error" chip and PWA dialogs not re-exercised.
