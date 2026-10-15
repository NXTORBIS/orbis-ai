/*
 * Jarvis export: run this in the browser console of YOUR OWN signed-in Base44 editor tab for the Jarvis app.
 *
 *   1. Open the app in Base44 (the URL looks like https://app.base44.com/apps/<id>/editor/...).
 *   2. Open the browser's developer tools -> Console.
 *   3. Paste this whole file and press Enter. It reads the project's files through the same API the editor uses,
 *      with your own session, and saves ONE file to your Downloads: jarvis-export.json.
 *   4. Then run:  node scripts/jarvis-unpack.mjs "<path to jarvis-export.json>" "C:/Users/ksran/Downloads/jarvis-extract"
 *
 * It only reads. It sends nothing anywhere: the file is built in this tab and saved by the browser.
 * It follows import statements and import.meta.glob directories, and tries every PascalCase name a wave's
 * definitions mention as a file in that wave's tools folder, so tools loaded by glob are found too.
 */
;(async () => {
  const appId = (location.pathname.match(/\/apps\/([0-9a-f]{24})/) || [])[1]
  if (!appId) return console.error('Open the Base44 editor for the app first (URL must contain /apps/<id>/).')
  const api = `/api/apps/${appId}/code/content`
  const files = {}
  const missing = new Set()
  const tried = new Set()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function read(path) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch(`${api}?path=${encodeURIComponent(path)}`, { credentials: 'include' })
      if (r.status === 429) { await sleep(400 * (attempt + 1)); continue }
      if (!r.ok) return null
      const j = await r.json()
      return typeof j.content === 'string' ? j.content : null
    }
    return null
  }

  const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx', '/index.ts', '/index.tsx']
  const resolveSpec = (from, spec) => {
    if (spec.startsWith('@/')) return 'src/' + spec.slice(2)
    if (!spec.startsWith('.')) return null
    const parts = from.split('/'); parts.pop()
    for (const seg of spec.split('/')) { if (seg === '.') continue; if (seg === '..') parts.pop(); else parts.push(seg) }
    return parts.join('/')
  }
  const queue = ['src/App.jsx', 'src/main.jsx', 'src/pages.config.js', 'src/Layout.jsx', 'src/components/toolkit/registry.js']
  const globDirs = new Set()

  function discover(path, text) {
    const re = /(?:import|export)[^'"`;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g
    let m
    while ((m = re.exec(text))) {
      const spec = m[1] || m[2] || m[3]
      const base = resolveSpec(path, spec)
      if (!base || /\.(css|png|svg|jpe?g|webp|gif)$/.test(base)) continue
      for (const e of EXTS) queue.push(base + e)
    }
    const g = /import\.meta\.glob\(\s*['"]\/?([^'"*]+)\/\*/g
    while ((m = g.exec(text))) globDirs.add(m[1].replace(/^\//, ''))
    // Components a wave's definitions name: PascalCase strings.
    if (/definitions|catalog/i.test(path)) {
      const names = new Set((text.match(/'([A-Z][A-Za-z0-9]+)'/g) || []).map((s) => s.slice(1, -1)))
      const dir = path.split('/').slice(0, -1).join('/')
      for (const n of names) for (const sub of ['tools', '']) for (const ext of ['.jsx', '.js']) queue.push(`${dir}/${sub ? sub + '/' : ''}${n}${ext}`)
    }
  }

  let done = 0
  const WORKERS = 4
  async function worker() {
    for (;;) {
      const path = queue.shift()
      if (path === undefined) { await sleep(150); if (queue.length === 0) return; continue }
      if (tried.has(path)) continue
      tried.add(path)
      const text = await read(path)
      if (text === null) { missing.add(path); continue }
      files[path] = text
      discover(path, text)
      if (++done % 50 === 0) console.log(`read ${done} files, ${queue.length} queued`)
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker))
  // A second sweep: every glob'd directory's names, from every file that names components for it.
  console.log(`first sweep: ${Object.keys(files).length} files; missing ${missing.size}`)
  const out = JSON.stringify({ appId, exportedAt: new Date().toISOString(), count: Object.keys(files).length, files })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([out], { type: 'application/json' }))
  a.download = 'jarvis-export.json'
  document.body.append(a)
  a.click()
  a.remove()
  console.log(`saved jarvis-export.json: ${Object.keys(files).length} files, ${(out.length / 1048576).toFixed(1)} MB`)
})()
