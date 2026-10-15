import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatHtml, chatMarkdown } from './chatExport.ts'

const names = { user: 'Nishanth', assistant: 'Orion' }
const msgs = [
  { role: 'user' as const, content: 'Is <b>this</b> safe?', attachments: [{ name: 'a.pdf' }] },
  { role: 'assistant' as const, content: 'Yes.\n\n```py\nprint("<hi>")\n```\n\nDone.' },
  { role: 'assistant' as const, content: '' }
]

test('markdown names each speaker, keeps attachments, and skips empty turns', () => {
  const md = chatMarkdown('T', msgs, names)
  assert.match(md, /^# T\n/)
  assert.ok(md.includes('**Nishanth**') && md.includes('_Attached: a.pdf_') && md.includes('**Orion**'))
  assert.equal((md.match(/---/g) ?? []).length, 1)
})

test('the printable page never lets message text become markup', () => {
  const html = chatHtml('T <x>', msgs, names, 'now')
  assert.ok(!html.includes('<b>this</b>') && html.includes('&lt;b&gt;this&lt;/b&gt;'))
  assert.ok(html.includes('<pre>print(&quot;&lt;hi&gt;&quot;)</pre>'))
  assert.ok(html.includes('<title>T &lt;x&gt;</title>'))
})
