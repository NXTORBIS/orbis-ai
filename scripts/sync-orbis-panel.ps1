# Copies the Orbis panel (the extension's panel tabs, kept as one source of logic) and the shared orbis-ui library into
# orbis-ui/panel/ and from there into the Chromium tree as resources for the built-in chrome://orbis page.
# Usage: scripts/sync-orbis-panel.ps1 [-Src C:\chromium\src]
param([string]$Src = 'C:\chromium\src')
$root = Join-Path $PSScriptRoot '..'
$panel = Join-Path $root 'orbis-ui\panel'
New-Item -ItemType Directory -Force $panel | Out-Null
foreach ($f in 'panel.js','panel.css','panel-adblock.js','panel-notes.js','panel-tasks.js','panel-workflows.js','panel-galaxy.js','panel-secrets.js','helper.js') {
  Copy-Item (Join-Path $root "extension\$f") (Join-Path $panel $f) -Force
}
Copy-Item (Join-Path $root 'extension\assets\orbis-ring.png') (Join-Path $panel 'orbis-ring.png') -Force
# index.html is the built-in page's own shell (extension/panel.html plus the shared orbis-ui stylesheets); it lives in orbis-ui/panel.
$dest = Join-Path $Src 'chrome\browser\resources\orbis'
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($f in Get-ChildItem $panel -File) { Copy-Item $f.FullName (Join-Path $dest $f.Name) -Force }
foreach ($f in 'orbis-tokens.css','orbis.css','orbis-components.js') { Copy-Item (Join-Path $root "orbis-ui\$f") (Join-Path $dest $f) -Force }
"synced orbis panel resources into $dest"
