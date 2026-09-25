import { openAlex } from './src/search-service/engines.ts'
const c = new AbortController(); setTimeout(() => c.abort(), 20000)
const t = Date.now()
try { const r = await openAlex(fetch).search('mars', c.signal); console.log('openalex ok', r.length, 'in', Date.now()-t, 'ms') }
catch (e) { console.log('openalex THREW after', Date.now()-t, 'ms:', e.name, '|', e.message) }
