# Starts the Orbis helper and opens the Chromium build with the Orbis side panel loaded.
#
#   powershell -File scripts\run-orbis-chromium.ps1 [-Chrome C:\path\to\chrome.exe] [-Profile C:\path\to\profile] [url]
#
# The Groq key is read here, from GROQ_API_KEY in .env.local, and handed to the helper's environment. It is never
# printed, logged or written anywhere. The helper writes its port and a fresh secret token into the extension's own
# folder (helper.json), which is how the panel finds it; that file is git-ignored and replaced on every start.
param(
  [string]$Chrome = 'C:\chromium\src\out\Default\chrome.exe',
  [string]$Profile = 'C:\chromium\orbis-test-profile',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $repo 'extension'
$panelId = 'gcaebckmlhiagfagcplpjmibhkhjljab'   # fixed by the key in extension\manifest.json
$state = Join-Path $extension 'helper.json'

if (-not (Test-Path $Chrome)) { throw "Chromium build not found at $Chrome" }

# Read the key(s) without ever echoing them.
$keys = ''
$envFile = Join-Path $repo '.env.local'
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*GROQ_API_KEY\s*=' } | Select-Object -First 1
  if ($line) { $keys = (($line -split '=', 2)[1]).Trim().Trim('"').Trim("'") -replace '\s+', ',' }
}
if (-not $keys) { Write-Host 'No GROQ_API_KEY found in .env.local: the panel will open, but Orion cannot answer until it is set.' }
$env:ORBIS_GROQ_API_KEYS = $keys

# Replace any helper still running from before, and any token file it left behind.
if (Test-Path $state) {
  try { $old = (Get-Content $state -Raw | ConvertFrom-Json).pid; if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue } } catch {}
  [System.IO.File]::Delete($state)
}

# Paths here contain spaces, and Start-Process does not quote array items, so the one that can is quoted by hand.
$helperLog = Join-Path $env:TEMP 'orbis-helper.log'
$helper = Start-Process -FilePath 'node' -WindowStyle Hidden -PassThru -WorkingDirectory $repo `
  -RedirectStandardOutput $helperLog -RedirectStandardError ($helperLog + '.err') -ArgumentList @(
  '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types',
  'src/helper/main.ts', '--data-dir', "`"$extension`"", '--allow-origin', "chrome-extension://$panelId")
for ($i = 0; $i -lt 60 -and -not (Test-Path $state); $i++) { Start-Sleep -Milliseconds 250 }
if (-not (Test-Path $state)) {
  $why = (Get-Content ($helperLog + '.err') -ErrorAction SilentlyContinue | Select-Object -Last 3) -join ' '
  throw "The Orbis helper did not start. $why"
}
Write-Host "Orbis helper is running (pid $($helper.Id))."

$chromeArgs = @("--user-data-dir=`"$Profile`"", "--load-extension=`"$extension`"", '--no-first-run') + $Rest
Start-Process -FilePath $Chrome -ArgumentList $chromeArgs
Write-Host 'Chromium opened. Click the Orbis button in the toolbar (or the puzzle-piece menu) to open the side panel.'
