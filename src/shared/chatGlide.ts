/**
 * A reply that glides in: while it streams, the words of its *last block* are each wrapped in a span, so a word that
 * has just arrived is a new element and plays a short fade as it mounts, while the words already there are the same
 * elements as before and stay still.
 *
 * Only the last top-level block is touched (a long reply must not become thousands of spans), and nothing is wrapped
 * inside code, links, maths or tables. The plugin is applied only while a reply is streaming; when it ends the spans
 * are gone and the text is exactly what the reply said.
 */

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const SKIP = new Set(['code', 'pre', 'a', 'table', 'svg', 'math', 'annotation'])

function wrap(node: HastNode): void {
  if (!node.children) return
  const out: HastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      for (const part of child.value.split(/(\s+)/)) {
        if (part === '') continue
        if (/^\s+$/.test(part)) out.push({ type: 'text', value: part })
        else out.push({ type: 'element', tagName: 'span', properties: { className: ['glide'] }, children: [{ type: 'text', value: part }] })
      }
    } else if (child.type === 'element' && !SKIP.has(child.tagName ?? '') && !(Array.isArray(child.properties?.className) && (child.properties?.className as string[]).some((c) => c.startsWith('katex')))) {
      wrap(child)
      out.push(child)
    } else out.push(child)
  }
  node.children = out
}

export function rehypeGlide(): (tree: HastNode) => void {
  return (tree) => {
    const blocks = (tree.children ?? []).filter((c) => c.type === 'element')
    const last = blocks[blocks.length - 1]
    if (last && !SKIP.has(last.tagName ?? '')) wrap(last)
  }
}
