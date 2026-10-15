/**
 * Bridges Orbis Files' AI contract to Orbis's existing Orion completions.
 *
 * Implements AiProviderAdapter so the Files subsystem can use Orion for
 * file explanations, summaries, folder analysis, etc. without any separate
 * API key or configuration.
 */

import { net } from 'electron'
import type { AiProviderAdapter } from '../files/shared/integration/ai-contract'
import { AI_CONTRACT_VERSION } from '../files/shared/integration/ai-contract'

declare const __GROQ_API_KEYS__: string[]
declare const __MISTRAL_API_KEYS__: string[]

const PROVIDERS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', model: 'ministral-8b-latest' },
} as const

let keyIndex = 0
function nextKey(): { baseUrl: string; model: string; key: string } | null {
  const gKeys = typeof __GROQ_API_KEYS__ !== 'undefined' ? __GROQ_API_KEYS__ : []
  if (gKeys.length > 0) {
    const key = gKeys[keyIndex % gKeys.length]
    keyIndex++
    return { ...PROVIDERS.groq, key }
  }
  const mKeys = typeof __MISTRAL_API_KEYS__ !== 'undefined' ? __MISTRAL_API_KEYS__ : []
  if (mKeys.length > 0) {
    const key = mKeys[keyIndex % mKeys.length]
    keyIndex++
    return { ...PROVIDERS.mistral, key }
  }
  return null
}

function buildPrompt(request: { kind: string; prompt?: string; context: Array<{ ref: string; name: string; share: string; content?: { data: string }; listing?: { entries: Array<{ name: string; kind: string }> } }> }): string {
  const parts: string[] = []

  if (request.prompt) parts.push(request.prompt)

  for (const ctx of request.context ?? []) {
    if (ctx.share === 'content' && ctx.content?.data) {
      parts.push(`[${ctx.name}]\n${ctx.content.data}`)
    } else if (ctx.listing) {
      const entries = ctx.listing.entries.map(e => `  ${e.kind === 'directory' ? '📁' : '📄'} ${e.name}`).join('\n')
      parts.push(`[${ctx.name}]\n${entries}`)
    }
  }

  return parts.join('\n\n').slice(0, 16000)
}

const SYSTEM: Record<string, string> = {
  explain_file: 'Explain what this file does, its purpose and key parts. Be concise.',
  summarize_document: 'Summarise this document. Focus on what matters.',
  extract_structured: 'Extract structured information from the given content. Return observations as facts.',
  compare_interpret: 'Compare the given items and describe their differences and similarities.',
  folder_analysis: 'Analyse this folder structure. Describe its organisation, purpose and any issues.',
  nl_search_plan: 'Given a natural-language search query, produce a search plan: which scope to search and why.',
  organize_suggestions: 'Suggest how to organise these files better. Return proposals as JSON with op/from/toDir/toName/reason fields.',
  generate_file: 'Generate the requested file content.',
  edit_file: 'Edit the file as requested.',
}

export function createOrionAdapter(): AiProviderAdapter {
  return {
    async connect(_signal) {
      const k = nextKey()
      if (!k) throw new Error('No AI keys configured')
      return {
        providerId: 'orbis-orion',
        providerName: 'Orion',
        providerVersion: '1.0.0',
        contractVersion: AI_CONTRACT_VERSION,
        capabilities: [
          'explain_file', 'summarize_document', 'extract_structured',
          'compare_interpret', 'folder_analysis', 'nl_search_plan',
          'organize_suggestions',
        ],
        processing: 'remote' as const,
        limits: { maxContextBytes: 1024 * 1024, maxFiles: 50, maxFileBytes: 512 * 1024 },
        models: [{ id: k.model, label: k.model }],
      }
    },

    async ping(_signal) {
      return nextKey() !== null
    },

    async run(request: { taskId: string; kind: string; prompt?: string; context: any[]; timeoutMs: number }, onProgress, signal) {
      const k = nextKey()
      if (!k) throw new Error('No AI keys configured')

      const system = SYSTEM[request.kind] ?? 'You are Orion, helping with file management tasks. Be concise and accurate.'
      const user = buildPrompt(request)

      onProgress({ taskId: request.taskId, fraction: 0.1, message: 'Thinking…' })

      const res = await net.fetch(`${k.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${k.key}`,
        },
        body: JSON.stringify({
          model: k.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
        signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return {
          taskId: request.taskId,
          status: 'failed' as const,
          error: { code: `http_${res.status}`, message: text.slice(0, 200) },
        }
      }

      const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      const answer = json.choices?.[0]?.message?.content ?? ''

      onProgress({ taskId: request.taskId, fraction: 1, message: 'Done' })

      return {
        taskId: request.taskId,
        status: 'completed' as const,
        answer,
      }
    },

    async disconnect() {},
  }
}
