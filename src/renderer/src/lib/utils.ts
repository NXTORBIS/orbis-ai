import type { Conversation } from '../../../shared/types'

export const newId = (): string => crypto.randomUUID()

export function titleFromMessage(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return 'New chat'
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line
}

const DAY = 86_400_000

export function groupConversations(list: Conversation[], now = new Date()): { label: string; items: Conversation[] }[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const buckets = [
    { label: 'Today', from: today },
    { label: 'Yesterday', from: today - DAY },
    { label: 'Previous 7 days', from: today - 7 * DAY },
    { label: 'Previous 30 days', from: today - 30 * DAY },
    { label: 'Older', from: -Infinity }
  ]
  const groups = buckets.map((b) => ({ label: b.label, items: [] as Conversation[] }))
  for (const c of list) groups[buckets.findIndex((b) => c.updatedAt >= b.from)].items.push(c)
  return groups.filter((g) => g.items.length)
}

/** remark-math only understands $ delimiters; models often emit \( \) and \[ \]. Code is left untouched. */
export function normalizeMath(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, math: string) => `$${math}$`)
    )
    .join('')
}

interface HastNode {
  type: string
  value?: string
  children?: HastNode[]
}

export function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}
