# Joins dark and light captures of the same pages into review sheets: each sheet = N pages, dark on the left, light on the right.
param([string]$Dir, [string]$Out, [int]$Per = 2, [string]$Filter = '')
Add-Type -AssemblyName System.Drawing
$dark = Get-ChildItem $Dir -Filter '*_dark.png' | Where-Object { $_.Name -like "*$Filter*" } | Sort-Object Name
New-Item -ItemType Directory -Force $Out | Out-Null
$i = 0; $sheet = 0
while ($i -lt $dark.Count) {
  $batch = $dark[$i..([Math]::Min($i + $Per - 1, $dark.Count - 1))]
  $tw = 640; $th = 400
  $bmp = New-Object System.Drawing.Bitmap ($tw * 2), ($th * $batch.Count)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.Clear([System.Drawing.Color]::Gray)
  $row = 0
  foreach ($d in $batch) {
    foreach ($s in 'dark','light') {
      $p = Join-Path $Dir ($d.Name -replace '_dark\.png$', "_$s.png")
      if (Test-Path $p) { $im = [System.Drawing.Image]::FromFile($p); $g.DrawImage($im, $(if ($s -eq 'dark') { 0 } else { $tw }), $row * $th, $tw - 2, $th - 2); $im.Dispose() }
    }
    $row++
  }
  $g.Dispose(); $bmp.Save((Join-Path $Out ("sheet{0:D2}.png" -f $sheet))); $bmp.Dispose()
  "sheet{0:D2}: {1}" -f $sheet, (($batch | % { $_.Name -replace '_dark\.png$','' }) -join ' | ')
  $i += $Per; $sheet++
}
