// Copies the runtime files of Orbis's Chromium build (not its build products) into resources/chromium, for the installer.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const from = process.env.ORBIS_CHROMIUM_OUT || 'C:/chromium/src/out/Default'
const to = join(process.cwd(), 'resources', 'chromium')
if (!existsSync(join(from, 'chrome.exe'))) throw new Error(`No Chromium build at ${from} (set ORBIS_CHROMIUM_OUT).`)
rmSync(to, { recursive: true, force: true })
mkdirSync(to, { recursive: true })
const skipExt = /\.(lib|pdb|obj|ilk|exp|o|a|ninja|gn|gni|py|json5|siso_.*|d|stamp|res|rc|h|cc|txt|log)$/i
// Runtime files only: the executable, its libraries, packs, data blobs and folders the browser reads at start.
const keepDirs = new Set(['locales', 'resources', 'MEIPreload', 'PrivacySandboxAttestationsPreloaded', 'WidevineCdm', 'Extensions', 'default_apps'])
for (const name of readdirSync(from)) {
  const p = join(from, name)
  const s = statSync(p)
  if (s.isDirectory()) {
    if (keepDirs.has(name)) cpSync(p, join(to, name), { recursive: true })
  } else if ((/\.(dll|pak|bin|dat|json)$/i.test(name) && !skipExt.test(name)) || /^(chrome|chrome_proxy|notification_helper|chrome_pwa_launcher|elevation_service)\.exe$/i.test(name) || name === 'chrome.VisualElementsManifest.xml' || /^[0-9.]+.manifest$/.test(name)) cpSync(p, join(to, name))
}
console.log('staged', to)
