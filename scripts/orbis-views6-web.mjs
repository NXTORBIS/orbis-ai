// Views 6 (D1,D3,D4,D5) for WebUI pages: AX names, forced-colors, reduced motion, 390px / 200% checks. Usage: node ... [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, sleep, ROOT } from './orbis-views6-lib.mjs'
const out = ROOT + 'docs/views6-shots/'
const urls = (process.env.URLS || 'chrome://orbis/,chrome://orbis-newtab/,chrome://orbis-search/#q=hello&in=orion,chrome://settings/,chrome://settings/appearance,chrome://settings/privacy').split(',')
const b = await launch({ name: 'web', size: '1200,800' })
const log = (...a) => console.log(...a)
const slug = (u) => u.replace(/^chrome:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 30)
const NAMED = new Set(['button', 'link', 'textbox', 'checkbox', 'combobox', 'radio', 'switch', 'slider', 'tab', 'menuitem', 'searchbox', 'spinbutton', 'listbox', 'img', 'image', 'treeitem', 'option', 'menuitemcheckbox', 'menuitemradio', 'PdfActionableHighlight'])
const SCAN = `(() => { const out = { overflowX: document.documentElement.scrollWidth - innerWidth, clipped: [], anims: 0, transMax: 0, animMax: 0, transEls: [] };
  const all = []; const walk = (r) => { for (const e of r.querySelectorAll('*')) { all.push(e); if (e.shadowRoot) walk(e.shadowRoot) } }; walk(document);
  const td = (s) => Math.max(0, ...s.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 0.001 : 1) || 0));
  for (const e of all) { const cs = getComputedStyle(e); const t = td(cs.transitionDuration), a = td(cs.animationDuration); if (t > 0 && cs.transitionProperty !== 'none') { out.transMax = Math.max(out.transMax, t); if (out.transEls.length < 6) out.transEls.push(e.tagName + '.' + (e.className||'').toString().slice(0,20) + ' ' + cs.transitionDuration) } if (a > 0 && cs.animationName !== 'none') out.animMax = Math.max(out.animMax, a);
    const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > innerWidth + 1 && cs.position !== 'fixed' && out.clipped.length < 8) out.clipped.push(e.tagName + '.' + (e.className||'').toString().slice(0,25) + ' r=' + Math.round(r.right)) }
  out.anims = document.getAnimations({ subtree: true }).length; return JSON.stringify(out) })()`
try {
  await sleep(1500)
  for (const u of urls) {
    const s0 = slug(u)
    const { result: { targetId } } = await b.send('Target.createTarget', { url: 'about:blank' })
    const s = await b.attach(targetId)
    const shot = async (tag) => { const r = await b.send('Page.captureScreenshot', { format: 'png' }, s); writeFileSync(`${out}web-${s0}-${tag}.png`, Buffer.from(r.result.data, 'base64')) }
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 750, deviceScaleFactor: 1, mobile: false }, s)
    await b.send('Page.enable', {}, s); await b.send('Page.navigate', { url: u }, s); await sleep(3500)
    // AX names
    await b.send('Accessibility.enable', {}, s)
    const ax = (await b.send('Accessibility.getFullAXTree', {}, s, 30000)).result?.nodes ?? []
    const bad = ax.filter((n) => !n.ignored && NAMED.has(n.role?.value) && !(n.name?.value || '').trim()).map((n) => `${n.role.value}#${n.backendDOMNodeId}`)
    const htmlBad = await b.eval(s, `(() => { const o=[]; const walk=(r)=>{ for (const e of r.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab],[role=switch],[role=checkbox]')) { const t=(e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent||e.value||'').trim(); const lab=(e.labels&&e.labels.length)||e.getAttribute('aria-labelledby'); const vis=e.getBoundingClientRect().width>0; if(!t&&!lab&&vis&&e.type!=='hidden') o.push(e.tagName+'#'+e.id+'.'+(e.className||'').toString().slice(0,20)) } for (const e of r.querySelectorAll('*')) if(e.shadowRoot) walk(e.shadowRoot) }; walk(document); return JSON.stringify(o.slice(0,15)) })()`)
    log(`## ${u}: AX nodes ${ax.length}; unnamed interactive AX: ${bad.length} ${bad.slice(0, 8).join(' ')}; DOM unnamed visible: ${htmlBad}`)
    await shot('normal')
    // forced colors
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: 'dark' }] }, s); await sleep(600); await shot('forced'); 
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] }, s)
    // reduced motion
    const before = await b.eval(s, SCAN)
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s); await sleep(600)
    await b.send('Page.reload', {}, s); await sleep(3000)
    log('  motion normal-page-before:', before)
    log('  motion reduce:', await b.eval(s, SCAN))
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, s)
    // 390px and 200% (640 css px at DPR 2 ~ 200% of 1280)
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false }, s); await sleep(800)
    log('  390px:', await b.eval(s, SCAN)); await shot('w390')
    await b.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 400, deviceScaleFactor: 2, mobile: false }, s); await sleep(800)
    log('  200% (640x400 css):', await b.eval(s, SCAN)); await shot('z200')
    await b.send('Target.closeTarget', { targetId }).catch(() => {})
  }
} catch (e) { log('ERR', e.message) } finally { b.kill() }
