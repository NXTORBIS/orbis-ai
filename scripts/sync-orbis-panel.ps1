# Copies the built-in Orbis pages into the Chromium tree as resources (chrome/browser/resources/orbis):
#   chrome://orbis         orbis-ui/panel      (the Orbis panel: Ask, Search, Blocking, Notes, Tasks, Workflows, Galaxy, Secrets)
#   chrome://orbis-newtab  orbis-ui/newtab     (the new tab page)
#   chrome://orbis-search  orbis-ui/results    (Orbis Search results; results.js is built by scripts/build-extension.mjs from results.ts)
# plus the shared orbis-ui library (tokens, components) and the helper client (orbis-ui/panel/helper.js).
# Usage: scripts/sync-orbis-panel.ps1 [-Src C:\chromium\src]
param([string]$Src = 'C:\chromium\src')
$root = Join-Path $PSScriptRoot '..'
$ui = Join-Path $root 'orbis-ui'
$dest = Join-Path $Src 'chrome\browser\resources\orbis'
New-Item -ItemType Directory -Force $dest | Out-Null
if (-not (Test-Path (Join-Path $ui 'panel/sidebar.js'))) { throw 'orbis-ui/panel/sidebar.js is not built (node scripts/build-extension.mjs).' }
foreach ($f in Get-ChildItem (Join-Path $ui 'panel') -File | Where-Object { $_.Extension -ne '.ts' }) { Copy-Item $f.FullName (Join-Path $dest $f.Name) -Force }
foreach ($f in 'orbis-tokens.css','orbis.css','orbis-components.js') { Copy-Item (Join-Path $ui $f) (Join-Path $dest $f) -Force }
foreach ($f in 'newtab.js','newtab.css','newtab-logic.js','newtab-store.js') { Copy-Item (Join-Path $ui "newtab\$f") (Join-Path $dest $f) -Force }
Copy-Item (Join-Path $ui 'newtab\index.html') (Join-Path $dest 'newtab.html') -Force
if (-not (Test-Path (Join-Path $ui 'results\results.js'))) { throw 'orbis-ui/results/results.js is not built (node scripts/build-extension.mjs).' }
foreach ($f in 'results.js','results.css') { Copy-Item (Join-Path $ui "results\$f") (Join-Path $dest $f) -Force }
Copy-Item (Join-Path $ui 'results\index.html') (Join-Path $dest 'results.html') -Force
"synced orbis page resources into $dest"
# The generated design-token header for Views (scripts/build-orbis-ui.mjs writes it from orbis-ui/tokens.json).
$hdr = Join-Path $ui 'generated\orbis_tokens.h'
if (-not (Test-Path $hdr)) { throw 'orbis-ui/generated/orbis_tokens.h is missing (node scripts/build-orbis-ui.mjs).' }
Copy-Item $hdr (Join-Path $Src 'ui\color\orbis_tokens.h') -Force
"synced ui/color/orbis_tokens.h"
# Shared WebUI style foundation, generated from tokens.json by scripts/build-orbis-ui.mjs.
$gen = Join-Path $ui 'generated'
foreach ($f in 'cr_shared_vars.css') { if (-not (Test-Path (Join-Path $gen $f))) { throw "orbis-ui/generated/$f is missing (node scripts/build-orbis-ui.mjs)." } }
Copy-Item (Join-Path $gen 'cr_shared_vars.css') (Join-Path $Src 'ui\webui\resources\cr_elements\cr_shared_vars.css') -Force
Copy-Item (Join-Path $gen 'md_colors.css') (Join-Path $Src 'ui\webui\resources\css\md_colors.css') -Force
# The Inter variable font (SIL OFL 1.1, from @fontsource-variable/inter, the same font the Orbis app uses), served as chrome://resources/inter/...
$fdir = Join-Path $Src 'ui\webui\resources\inter'
New-Item -ItemType Directory -Force $fdir | Out-Null
foreach ($f in 'inter-latin-wght-normal.woff2','inter-latin-ext-wght-normal.woff2') { Copy-Item (Join-Path $root "node_modules\@fontsource-variable\inter\files\$f") (Join-Path $fdir $f) -Force }
Copy-Item (Join-Path $root 'node_modules\@fontsource-variable\inter\LICENSE') (Join-Path $fdir 'LICENSE') -Force
# Windows WebUI font family (IDS_WEB_FONT_FAMILY) = the token font stack.
$grd = Join-Path $Src 'ui\strings\app_locale_settings.grd'
$stack = ((Get-Content (Join-Path $gen 'webui_font_family.txt') -Raw).Trim()) -replace '"',"'"
$txt = [IO.File]::ReadAllText($grd)
$new = [regex]::Replace($txt, "(<message name=`"IDS_WEB_FONT_FAMILY`" use_name_for_id=`"true`">\s*)('Inter Variable'[^\r\n]*|'Segoe UI', Tahoma, sans-serif)", { param($m) $m.Groups[1].Value + $stack }, 'None', [TimeSpan]::FromSeconds(5))
if ($new -ne $txt) { [IO.File]::WriteAllText($grd, $new) }
"synced shared WebUI style foundation (cr_shared_vars.css, md_colors.css, Inter, web font family)"
