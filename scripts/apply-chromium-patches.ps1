# Re-applies Orbis's changes to the Chromium source after a `gclient sync` / `git checkout --force` has reset the tree.
# Order: sync-orbis-panel.ps1 (copies orbis-ui resources, generated tokens/fonts into the tree), then the patches by name,
# then chromium-orbis-pages-final.patch (stacked on the others: it edits files they also touch), then
# chromium-orbis-uncaptured.patch (raw byte delta for tree changes no other patch carries; applied with core.autocrlf=false).
# Idempotent: if the last patch of the stack reverse-checks, the whole stack is applied and nothing is done; otherwise
# each patch that already reverse-checks is skipped. Any patch that fails to apply throws.
# -Exclude: patch file names to leave out (used by prove-patches.ps1 -Regenerate).
param([string]$Src = 'C:\chromium\src', [string[]]$Exclude = @())
$ErrorActionPreference = 'Continue'
& (Join-Path $PSScriptRoot 'sync-orbis-panel.ps1') -Src $Src
$all = @(Get-ChildItem (Join-Path $PSScriptRoot '..\patches') -Filter 'chromium-*.patch' | Where-Object { $Exclude -notcontains $_.Name } | Sort-Object Name)
$tail = 'chromium-orbis-pages-final.patch', 'chromium-orbis-uncaptured.patch'
$patches = @($all | Where-Object { $tail -notcontains $_.Name }) + @($tail | ForEach-Object { $n = $_; $all | Where-Object Name -eq $n })
function Apply-Git([string]$Check, [string]$File) {
  # the raw-byte delta must not go through any line-ending conversion; the others were made against a normal (autocrlf) checkout
  $a = @('-C', $Src)
  if ($File -like '*uncaptured*') { $a += @('-c', 'core.autocrlf=false') }
  $a += @('apply', '--binary')
  if ($Check -eq 'reverse') { $a += @('--check', '--reverse') }
  & git @a $File 2>$null
  return $LASTEXITCODE
}
$last = $patches[-1]
if ((Apply-Git 'reverse' $last.FullName) -eq 0) { "already applied: whole stack ($($last.Name) is on top)"; return }
foreach ($p in $patches) {
  if ((Apply-Git 'reverse' $p.FullName) -eq 0) { "already applied: $($p.Name)"; continue }
  if ((Apply-Git 'apply' $p.FullName) -ne 0) { throw "could not apply $($p.Name)" }
  "applied: $($p.Name)"
}
