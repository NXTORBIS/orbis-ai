# Re-applies Orbis's changes to the Chromium source after a `gclient sync` / `git checkout --force` has reset the tree.
# Safe to run repeatedly: a patch that is already applied is skipped.
param([string]$Src = 'C:\chromium\src')
& (Join-Path $PSScriptRoot 'sync-orbis-panel.ps1') -Src $Src
$patches = Get-ChildItem (Join-Path $PSScriptRoot '..\patches') -Filter 'chromium-*.patch' | Sort-Object Name
foreach ($p in $patches) {
  git -C $Src apply --check --reverse $p.FullName 2>$null
  if ($LASTEXITCODE -eq 0) { "already applied: $($p.Name)"; continue }
  git -C $Src apply $p.FullName
  if ($LASTEXITCODE -ne 0) { throw "could not apply $($p.Name)" }
  "applied: $($p.Name)"
}
