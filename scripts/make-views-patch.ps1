# Regenerates patches/chromium-orbis-views-tabstrip.patch from a snapshot of the pre-change files (dev helper).
# usage: scripts/make-views-patch.ps1 -Before <dir with original copies laid out as in the tree> [-Src C:\chromium\src]
param([Parameter(Mandatory)][string]$Before, [string]$Src = 'C:\chromium\src')
$out = Join-Path $PSScriptRoot '..\patches\chromium-orbis-views-tabstrip.patch'
$tmp = Join-Path $env:TEMP 'orbis-patchgen'
if (Test-Path $tmp) { [IO.Directory]::Delete($tmp, $true) }
New-Item -ItemType Directory -Force "$tmp\a", "$tmp\b" | Out-Null
$root = (Resolve-Path $Before).Path
foreach ($f in Get-ChildItem $Before -Recurse -File) {
  $rel = $f.FullName.Substring($root.Length + 1)
  foreach ($d in 'a', 'b') { New-Item -ItemType Directory -Force (Split-Path "$tmp\$d\$rel") | Out-Null }
  Copy-Item $f.FullName "$tmp\a\$rel"; Copy-Item (Join-Path $Src $rel) "$tmp\b\$rel"
}
Push-Location $tmp
cmd /c "git -c core.autocrlf=false diff --no-index --no-color a b > patch.raw"
Pop-Location
# git prints a/a/... and b/b/... for a no-index diff of directories; strip the extra level. Bytes are kept exact.
$enc = [Text.Encoding]::GetEncoding(28591)
$txt = $enc.GetString([IO.File]::ReadAllBytes("$tmp\patch.raw"))
$txt = $txt -replace '(?m)^(diff --git )a/a/(\S+) b/b/(\S+)', '$1a/$2 b/$3' -replace '(?m)^--- a/a/', '--- a/' -replace '(?m)^\+\+\+ b/b/', '+++ b/'
[IO.File]::WriteAllBytes($out, $enc.GetBytes($txt))
"wrote $out"
