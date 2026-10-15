/**
 * Callouts in a chat reply: a quote whose first words are a label ("Note:", "Warning", "[!TIP]") is drawn as a
 * highlighted card with that label, instead of a plain indented quote.
 *
 * It is a rehype plugin over the reply's own syntax tree, not a regular expression over its text: only a real
 * blockquote is touched, only its first paragraph is read, and a quote that merely starts with a word like "Note" in
 * ordinary prose ("Note that…") is left alone. The label is removed from the text and given as `data-callout`; the
 * look is the stylesheet's.
 */

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

const WORDS: { re: RegExp; kind: CalloutKind }[] = [
  { re: /^(?:note|info|fyi)$/i, kind: 'note' },
  { re: /^(?:tip|hint|pro tip)$/i, kind: 'tip' },
  { re: /^(?:important|key point|remember)$/i, kind: 'important' },
  { re: /^(?:warning|warn|heads up|watch out)$/i, kind: 'warning' },
  { re: /^(?:caution|danger|careful|alert)$/i, kind: 'caution' }
]

export const CALLOUT_TITLE: Record<CalloutKind, string> = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }

/**
 * Reads a label off the start of a paragraph's text. Two forms count: `[!KIND]` (the form GitHub and many models use),
 * and a short word then a colon or dash ("Note:", "Warning –"). Returns the kind and how many characters to drop.
 */
export function calloutOf(text: string): { kind: CalloutKind; drop: number } | null {
  const bang = /^\s*\[!([A-Za-z ]{3,12})\]\s*/.exec(text)
  if (bang) {
    const hit = WORDS.find((w) => w.re.test(bang[1].trim()))
    if (hit) return { kind: hit.kind, drop: bang[0].length }
  }
  const word = /^\s*([A-Za-z][A-Za-z ]{1,10}?)\s*[:：–—-]\s+/.exec(text)
  if (word) {
    const hit = WORDS.find((w) => w.re.test(word[1].trim()))
    if (hit) return { kind: hit.kind, drop: word[0].length }
  }
  return null
}

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const isElement = (n: HastNode | undefined, tag?: string): n is HastNode => !!n && n.type === 'element' && (tag === undefined || n.tagName === tag)

/** The text at the very start of a paragraph, looking through one leading <strong>/<em>. */
function leadingText(p: HastNode): { holder: HastNode; node: HastNode } | null {
  const first = p.children?.find((c) => !(c.type === 'text' && (c.value ?? '').trim() === ''))
  if (!first) return null
  if (first.type === 'text') return { holder: p, node: first }
  if (isElement(first, 'strong') || isElement(first, 'em')) {
    const inner = first.children?.[0]
    if (inner?.type === 'text') return { holder: first, node: inner }
  }
  return null
}

function visit(node: HastNode): void {
  if (isElement(node, 'blockquote')) {
    const p = node.children?.find((c) => isElement(c, 'p'))
    const lead = p ? leadingText(p) : null
    if (p && lead && typeof lead.node.value === 'string') {
      // A bolded label ("**Note:** text") has its colon outside the bold or inside it; read the label and what follows as one.
      const next = lead.holder !== p ? p.children?.find((c) => c.type === 'text' && (c.value ?? '').trim() !== '') : undefined
      const joined = lead.holder !== p && next ? `${lead.node.value}${next.value ?? ''}` : lead.node.value
      const hit = calloutOf(joined)
      if (hit) {
        const props = (node.properties ??= {})
        const cls = Array.isArray(props.className) ? (props.className as string[]) : []
        props.className = [...cls, 'callout', `callout-${hit.kind}`]
        props['data-callout'] = CALLOUT_TITLE[hit.kind]
        if (lead.holder === p) {
          lead.node.value = lead.node.value.slice(hit.drop)
        } else {
          // Label inside <strong>: remove the strong's text entirely, and any colon or dash that follows it.
          const holderIndex = p.children?.indexOf(lead.holder) ?? -1
          if (holderIndex >= 0 && p.children) {
            p.children.splice(holderIndex, 1)
            const after = p.children[holderIndex]
            if (after?.type === 'text' && typeof after.value === 'string') after.value = after.value.replace(/^\s*[:：–—-]?\s*/, '')
          }
        }
      }
    }
  }
  for (const c of node.children ?? []) visit(c)
}

/** The rehype plugin. */
export function rehypeCallouts(): (tree: HastNode) => void {
  return (tree) => visit(tree)
}
