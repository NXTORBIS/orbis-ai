# Proves the patch stack + sync/generate steps reproduce the Chromium working tree byte for byte, without touching it.
# Builds a scratch repo of the pristine (HEAD) versions of every file that differs in $Src or is touched by a patch,
# runs scripts/apply-chromium-patches.ps1 against it, then hash-compares against $Src. Read-only use of $Src.
# Usage: scripts/prove-patches.ps1 [-Src C:\chromium\src] [-Scratch %TEMP%\orbis-patch-proof]
param([string]$Src = 'C:\chromium\src', [string]$Scratch = (Join-Path $env:TEMP 'orbis-patch-proof'), [switch]$Regenerate)
$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function G { param([string[]]$a) $o = & git -C $Src @a; if ($LASTEXITCODE -ne 0) { throw "git $a failed" }; $o }
# (1) files differing from HEAD (tracked changes + untracked, minus out/) and files touched by patches
$tree = [System.Collections.Generic.HashSet[string]]::new()
foreach ($f in (G @('diff','--name-only','HEAD'))) { [void]$tree.Add($f) }
foreach ($f in (G @('ls-files','-o','--exclude-standard'))) { if ($f -notmatch '^out/') { [void]$tree.Add($f) } }
$touched = [System.Collections.Generic.HashSet[string]]::new()
foreach ($p in Get-ChildItem (Join-Path $repo 'patches') -Filter 'chromium-*.patch') {
  foreach ($l in [IO.File]::ReadLines($p.FullName)) { if ($l -match '^diff --git a/(.+?) b/(.+)$') { [void]$touched.Add($Matches[2]) } }
}
$all = [System.Collections.Generic.HashSet[string]]::new($tree); $all.UnionWith($touched)
"working-tree files differing from HEAD: $($tree.Count); files touched by patches: $($touched.Count); union: $($all.Count)"
# (2) scratch repo with pristine versions
if (Test-Path $Scratch) { Remove-Item -Recurse -Force $Scratch }
New-Item -ItemType Directory -Force $Scratch | Out-Null
git -C $Scratch init -q; git -C $Scratch config core.autocrlf false; git -C $Scratch config user.email p@p; git -C $Scratch config user.name p
# .gitattributes files from HEAD so the scratch checkout converts line endings exactly as gclient's checkout did
$attrs = @(G @('ls-files','--','.gitattributes','**/.gitattributes'))
$pristine = 0
foreach ($f in @($all) + $attrs) {
  & git -C $Src cat-file -e "HEAD:$f" 2>$null
  if ($LASTEXITCODE -ne 0) { continue }
  $dst = Join-Path $Scratch $f; New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  cmd /c "git -C `"$Src`" cat-file blob HEAD:$f > `"$dst`""
  $pristine++
}
git -C $Scratch add -A 2>$null | Out-Null; git -C $Scratch commit -q -m pristine --allow-empty
# re-materialize the working files through the same core.autocrlf as the real tree (CRLF checkout on Windows)
$ac = (& git -C $Src config --get core.autocrlf); if ($ac) { git -C $Scratch config core.autocrlf $ac }
Get-ChildItem $Scratch -Force | Where-Object Name -ne '.git' | Remove-Item -Recurse -Force
git -C $Scratch checkout -f -- . 2>$null
"pristine files copied: $pristine (the rest are new files)"
# (3) apply flow
$unc = Join-Path $repo 'patches\chromium-orbis-uncaptured.patch'
if ($Regenerate) {
  # Apply everything except the uncaptured patch, then capture the raw byte delta to the real tree as the uncaptured patch.
  & (Join-Path $PSScriptRoot 'apply-chromium-patches.ps1') -Src $Scratch -Exclude 'chromium-orbis-uncaptured.patch'
  # info/attributes beats every .gitattributes: '-text' so git records raw bytes (no eol=lf / autocrlf normalisation) in the delta
  $info = Join-Path $Scratch '.git\info'; New-Item -ItemType Directory -Force $info | Out-Null
  [IO.File]::WriteAllText((Join-Path $info 'attributes'), "* -text`n")
  git -C $Scratch -c core.autocrlf=false add -A 2>$null | Out-Null; git -C $Scratch -c core.autocrlf=false commit -q -m stack
  foreach ($f in $all) { $a = Join-Path $Src $f; if (Test-Path $a) { $b = Join-Path $Scratch $f; New-Item -ItemType Directory -Force (Split-Path $b) | Out-Null; Copy-Item $a $b -Force } }
  git -C $Scratch -c core.autocrlf=false add -A 2>$null | Out-Null
  cmd /c "git -C `"$Scratch`" -c core.autocrlf=false diff --cached --binary --no-color > `"$unc`""
  "regenerated $unc ($((Get-Item $unc).Length) bytes)"
  Remove-Item (Join-Path $info 'attributes') -Force
  git -C $Scratch reset -q --hard HEAD~1 2>$null; git -C $Scratch -c core.autocrlf=false clean -fdq
  Get-ChildItem $Scratch -Force | Where-Object Name -ne '.git' | Remove-Item -Recurse -Force
  git -C $Scratch checkout -f -- . 2>$null
}
& (Join-Path $PSScriptRoot 'apply-chromium-patches.ps1') -Src $Scratch
# (4) compare
$match = 0; $diff = @(); $missing = @()
foreach ($f in $all) {
  $a = Join-Path $Src $f; $b = Join-Path $Scratch $f
  if (-not (Test-Path $a)) { if (Test-Path $b) { $diff += "$f (patched but absent in tree)" }; continue }
  if (-not (Test-Path $b)) { $missing += $f; continue }
  if ((Get-FileHash $a -Algorithm SHA256).Hash -eq (Get-FileHash $b -Algorithm SHA256).Hash) { $match++ } else { $diff += $f }
}
# files the scratch run changed that are not in $all cannot exist by construction; report tree-only files that would be lost
$lost = @($missing)
"MATCH: $match / $($all.Count)"
"DIFFER: $($diff.Count)"; $diff | ForEach-Object { "  $_" }
"LOST ON RESET (in tree, not produced): $($lost.Count)"; $lost | ForEach-Object { "  $_" }
if ($diff.Count -or $lost.Count) { exit 1 } else { 'PROOF OK: 100% of files reproduced' }
