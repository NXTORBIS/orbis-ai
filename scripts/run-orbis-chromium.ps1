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

# Addresses to open, passed through to the helper, which passes them to the browser it starts.
$urlArgs = @()
if ($Rest) { foreach ($u in ($Rest | Where-Object { $_ })) { $urlArgs += @('--url', $u) } }

# Replace any helper still running from before, and any token file it left behind.
if (Test-Path $state) {
  try { $old = (Get-Content $state -Raw | ConvertFrom-Json).pid; if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue } } catch {}
  [System.IO.File]::Delete($state)
}

# Paths here contain spaces, and Start-Process does not quote array items, so the one that can is quoted by hand.
#
# The helper starts the browser, rather than this script starting both. That is what gives Orbis control of it: Chromium
# is the helper's child, connected over the pipe --remote-debugging-pipe gives a parent, and only the process holding
# that pipe can drive the browser. Started separately, the two could see each other but not reach each other, and every
# request to act on the browser failed with "the browser is not ready".
$helperArgs = @(
  '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types',
  'src/helper/main.ts', '--data-dir', "`"$extension`"",
  '--allow-origin', "chrome-extension://$panelId", '--allow-origin', 'chrome://orbis', '--allow-origin', 'chrome://orbis-newtab',
  '--allow-origin', 'chrome://orbis-search', '--allow-origin', 'chrome://orbis-orb',
  '--chrome', "`"$Chrome`"", '--profile', "`"$Profile`"", '--extension-dir', "`"$extension`"", '--extension-id', $panelId
) + $urlArgs
# Deliberately not redirected. Redirecting this process's output stops the pipe handles reaching Chromium, so the
# browser starts and never speaks; the helper writes its own log beside helper.json instead.
$helper = Start-Process -FilePath 'node' -WindowStyle Hidden -PassThru -WorkingDirectory $repo -ArgumentList $helperArgs
for ($i = 0; $i -lt 60 -and -not (Test-Path $state); $i++) { Start-Sleep -Milliseconds 250 }
if (-not (Test-Path $state)) {
  $why = (Get-Content (Join-Path $extension 'helper.log') -ErrorAction SilentlyContinue | Select-Object -Last 3) -join ' '
  throw "The Orbis helper did not start. $why"
}
Write-Host "Orbis is running (helper pid $($helper.Id)). The browser is its own; closing the browser stops Orbis."
