/**
 * A conversation as a file: Markdown for anything that reads text, and a self-contained page for printing to PDF.
 * Pure, so what lands in the file can be tested without a window.
 */

export interface ExportMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: { name: string }[]
}

export function chatMarkdown(title: string, messages: ExportMessage[], names: { user: string; assistant: string }): string {
  const body = messages
    .filter((m) => m.content || m.attachments?.length)
    .map((m) => {
      const who = m.role === 'user' ? names.user : names.assistant
      const files = m.attachments?.length ? `\n\n_Attached: ${m.attachments.map((a) => a.name).join(', ')}_` : ''
      return `**${who}**\n\n${m.content}${files}`
    })
    .join('\n\n---\n\n')
  return `# ${title}\n\n${body}\n`
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Fenced code stays code; everything else becomes paragraphs. Nothing in the text is ever left as markup. */
function blocks(text: string): string {
  const out: string[] = []
  const parts = text.split(/```[^\n]*\n?/)
  parts.forEach((part, i) => {
    if (i % 2 === 1) out.push(`<pre>${esc(part.replace(/\n$/, ''))}</pre>`)
    else for (const p of part.split(/\n{2,}/)) if (p.trim()) out.push(`<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
  })
  return out.join('\n')
}

export function chatHtml(title: string, messages: ExportMessage[], names: { user: string; assistant: string }, madeAt: string): string {
  const rows = messages
    .filter((m) => m.content || m.attachments?.length)
    .map((m) => {
      const who = m.role === 'user' ? names.user : names.assistant
      const files = m.attachments?.length ? `<p class="files">Attached: ${esc(m.attachments.map((a) => a.name).join(', '))}</p>` : ''
      return `<section class="${m.role}"><h2>${esc(who)}</h2>${blocks(m.content)}${files}</section>`
    })
    .join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:14px/1.55 'Segoe UI',system-ui,sans-serif;color:#111;margin:32px auto;max-width:720px}
h1{font-size:22px;margin:0 0 4px}.made{color:#666;font-size:12px;margin-bottom:24px}
section{margin:0 0 18px;padding:0 0 14px;border-bottom:1px solid #ddd;break-inside:avoid-page}
h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#456;margin:0 0 6px}
p{margin:0 0 8px}pre{background:#f4f6f8;padding:10px;border-radius:6px;white-space:pre-wrap;word-break:break-word;font:12.5px Consolas,monospace}
.files{color:#666;font-style:italic}
</style></head><body><h1>${esc(title)}</h1><div class="made">Saved from Orbis · ${esc(madeAt)}</div>${rows}</body></html>`
}
