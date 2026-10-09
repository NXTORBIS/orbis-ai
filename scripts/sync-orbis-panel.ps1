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
# The guard used to be on panel/sidebar.js, which is deliberately no longer built -- it was the orphaned third
# registry, and build-extension.mjs says so in as many words. So this script threw on every run and nothing in
# orbis-ui/panel had reached the Chromium tree since the day that file stopped being produced. A guard has to name
# something the build still makes, or it stops being a check and becomes a wall.
if (-not (Test-Path (Join-Path $ui 'panel/rail/icons.js'))) { throw 'orbis-ui/panel/rail/icons.js is missing -- the panel sources are not where this expects them.' }
foreach ($f in Get-ChildItem (Join-Path $ui 'panel') -File | Where-Object { $_.Extension -ne '.ts' }) { Copy-Item $f.FullName (Join-Path $dest $f.Name) -Force }
foreach ($f in 'orbis-tokens.css','orbis.css','orbis-components.js') { Copy-Item (Join-Path $ui $f) (Join-Path $dest $f) -Force }
foreach ($f in 'newtab.js','newtab.css','newtab-logic.js','newtab-store.js','widgets.js','widget-logic.js','rail.js','intro.js','intro.css','backdrop-mount.js','orbis-wordmark.png') { Copy-Item (Join-Path $ui "newtab\$f") (Join-Path $dest $f) -Force }
Copy-Item (Join-Path $ui 'panel\rail\icons.js') (Join-Path $dest 'orbis-icons.js') -Force
# The Command Center imports the icon set at the path it really has, so the page and the working copy agree.
New-Item -ItemType Directory -Force (Join-Path $dest 'rail') | Out-Null
# The whole rail, not just its icons: index.js pulls in browser.js and stores.js, and those are where ten of the
# panel's views are registered. Copying one file of five meant the import failed and none of them existed.
foreach ($f in 'index.js','ui.js','icons.js','browser.js','stores.js') { Copy-Item (Join-Path $ui "panel\rail\$f") (Join-Path $dest "rail\$f") -Force }
foreach ($f in 'orb-app.js','orb-app.css','controls.js','voice.js') { Copy-Item (Join-Path $ui "orb\$f") (Join-Path $dest $f) -Force }
Copy-Item (Join-Path $ui 'orb\index.html') (Join-Path $dest 'orb.html') -Force
# The lock surface (chrome://orbis-lock), drawn over a locked tab. Its own page, and a deliberately tiny one: it knows a
# label and a tab id, never an address.
foreach ($f in 'lock.js','lock.css') { Copy-Item (Join-Path $ui "lock\$f") (Join-Path $dest $f) -Force }
Copy-Item (Join-Path $ui 'lock\index.html') (Join-Path $dest 'lock.html') -Force
# The market strip (chrome://orbis-ticker), along the bottom of the browser.
foreach ($f in 'ticker.js','ticker.css') { Copy-Item (Join-Path $ui "ticker\$f") (Join-Path $dest $f) -Force }
Copy-Item (Join-Path $ui 'ticker\index.html') (Join-Path $dest 'ticker.html') -Force
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
# Orbitron (SIL OFL 1.1), the display face of the greeting, served as chrome://resources/orbitron/.
$odir = Join-Path $Src 'ui\webui\resources\orbitron'
New-Item -ItemType Directory -Force $odir | Out-Null
Copy-Item (Join-Path $root 'node_modules\@fontsource\orbitron\files\orbitron-latin-700-normal.woff2') (Join-Path $odir 'orbitron-latin-700-normal.woff2') -Force
Copy-Item (Join-Path $root 'node_modules\@fontsource\orbitron\LICENSE') (Join-Path $odir 'LICENSE') -Force
# Windows WebUI font family (IDS_WEB_FONT_FAMILY) = the token font stack.
$grd = Join-Path $Src 'ui\strings\app_locale_settings.grd'
$stack = ((Get-Content (Join-Path $gen 'webui_font_family.txt') -Raw).Trim()) -replace '"',"'"
$txt = [IO.File]::ReadAllText($grd)
$new = [regex]::Replace($txt, "(<message name=`"IDS_WEB_FONT_FAMILY`" use_name_for_id=`"true`">\s*)('Inter Variable'[^\r\n]*|'Segoe UI', Tahoma, sans-serif)", { param($m) $m.Groups[1].Value + $stack }, 'None', [TimeSpan]::FromSeconds(5))
if ($new -ne $txt) { [IO.File]::WriteAllText($grd, $new) }
# Copy-Item preserves the source file's write time, so a resource edited before the last build but copied after it
# keeps an older timestamp than the .pak that was built from the previous copy. Ninja compares timestamps, decides
# nothing has changed, and silently serves the stale file while reporting a successful build. Stamping every file we
# have just written is what makes the next build see the change.
Get-ChildItem -Path $dest -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $_.LastWriteTime = Get-Date }
"synced shared WebUI style foundation (cr_shared_vars.css, md_colors.css, Inter, web font family)"
