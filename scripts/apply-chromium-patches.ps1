# Re-applies Orbis's changes to the Chromium source after a `gclient sync` / `git checkout --force` has reset the tree.
# Safe to run repeatedly: a patch that is already applied is skipped. chromium-orbis-pages-final.patch is stacked on top of the
# others (it edits files they also touch), so it is applied last, and if it is already applied the whole stack is.
param([string]$Src = 'C:\chromium\src')
& (Join-Path $PSScriptRoot 'sync-orbis-panel.ps1') -Src $Src
$all = Get-ChildItem (Join-Path $PSScriptRoot '..\patches') -Filter 'chromium-*.patch' | Sort-Object Name
$final = $all | Where-Object Name -eq 'chromium-orbis-pages-final.patch'
$patches = @($all | Where-Object Name -ne 'chromium-orbis-pages-final.patch') + @($final)
git -C $Src apply --check --reverse $final.FullName 2>$null
if ($LASTEXITCODE -eq 0) { 'already applied: whole stack (chromium-orbis-pages-final.patch is on top)'; return }
foreach ($p in $patches) {
  git -C $Src apply --check --reverse $p.FullName 2>$null
  if ($LASTEXITCODE -eq 0) { "already applied: $($p.Name)"; continue }
  git -C $Src apply $p.FullName
  if ($LASTEXITCODE -ne 0) { throw "could not apply $($p.Name)" }
  "applied: $($p.Name)"
}
