// Local servers for the Views 5 sweep (nothing leaves this machine):
//   http://127.0.0.1:8781/sample.pdf     a small multi-page PDF, for the PDF viewer
//   https://127.0.0.1:8782/              self-signed certificate -> ERR_CERT_AUTHORITY_INVALID interstitial
//   http://127.0.0.1:8783/               a page that answers, so a refused port (8784) is a real "connection refused"
import http from 'node:http'
import https from 'node:https'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
function pdf(pages) {
  const objs = []; const add = (s) => objs.push(s) && objs.length
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (let i = 0; i < pages; i++) {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)
    const t = `BT /F1 36 Tf 72 700 Td (Orbis PDF test page ${i + 1} of ${pages}) Tj ET BT /F1 14 Tf 72 660 Td (The quick brown fox jumps over the lazy dog.) Tj ET`
    add(`<< /Length ${t.length} >>\nstream\n${t}\nendstream`)
  }
  let out = '%PDF-1.4\n'; const off = []
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`
  return Buffer.from(out, 'latin1')
}
http.createServer((q, r) => { if (q.url.startsWith('/sample.pdf')) { r.writeHead(200, { 'content-type': 'application/pdf' }); r.end(pdf(6)) } else { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<title>ok</title><h1>ok</h1>') } }).listen(8781, '127.0.0.1')
http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<title>ok</title><h1>ok</h1>') }).listen(8783, '127.0.0.1')
const d = mkdtempSync(join(tmpdir(), 'orbis-cert-'))
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${join(d, 'k.pem')} -out ${join(d, 'c.pem')} -days 2 -subj "/CN=localhost"`, { stdio: 'ignore' })
https.createServer({ key: readFileSync(join(d, 'k.pem')), cert: readFileSync(join(d, 'c.pem')) }, (q, r) => { r.end('hi') }).listen(8782, '127.0.0.1')
console.log('servers up')
