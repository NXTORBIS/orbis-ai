// Screenshots of every rail view of the built-in Orbis panel, dark and light, narrow (360 px) and wide (900 px), through CDP on a headless
// system Chrome with a temp profile (see panel-ui-cdp.mjs).
//   node scripts/panel-ui-shots.mjs "<PAGE address printed by panel-ui-check.mjs>" <out dir> [--rows a,b,c]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sleep, withChrome } from './panel-ui-cdp.mjs'

const [pageUrl, outDir] = process.argv.slice(2)
const rowsArg = process.argv.includes('--rows') ? process.argv[process.argv.indexOf('--rows') + 1].split(',') : null
if (!pageUrl || !outDir) throw new Error('usage: panel-ui-shots.mjs <page url> <out dir>')
mkdirSync(outDir, { recursive: true })
const ROWS = rowsArg ?? ['tabs', 'tabGroups', 'media', 'controls', 'savedPages', 'screenshots', 'reminders', 'clipboard', 'whiteboard', 'research', 'sources', 'workspaces']
await withChrome(async ({ send, run, errors }) => {
  for (const scheme of ['dark', 'light']) {
    for (const [name, width, height] of [['narrow', 360, 780], ['wide', 900, 780]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
      await send('Page.navigate', { url: pageUrl })
      await sleep(1500)
      for (const row of ROWS) {
        errors.length = 0
        const found = await run(`(async () => { const b = document.querySelector('[data-rail-item="${row}"]'); if (!b) return false; b.click(); await new Promise(r => setTimeout(r, 1200)); return true })()`)
        if (!found) {
          console.log(`${scheme}/${name}/${row}: no rail row`)
          continue
        }
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        const file = join(outDir, `${row}-${name}-${scheme}.png`)
        writeFileSync(file, Buffer.from(shot.data, 'base64'))
        console.log(`${scheme}/${name}/${row}: ${file}${errors.length ? `  CONSOLE: ${errors.join(' | ')}` : ''}`)
      }
    }
  }
})
