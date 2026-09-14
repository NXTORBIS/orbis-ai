import { nativeImage } from 'electron'
import { GROQ_BASE_URL } from './nim'

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const POLITE = String.raw`(?:(?:hey|ok|okay)[,\s]+)?(?:please\s+|pls\s+|can you\s+|could you\s+|would you\s+|will you\s+|i want you to\s+|i'd like you to\s+|i want\s+|i need\s+|give me\s+|show me\s+)?(?:please\s+)?`
const NOUN = String.raw`(?:image|images|picture|pic|photo|photograph|drawing|painting|illustration|artwork|art|wallpaper|logo|icon|poster|sketch|render|portrait|avatar)`
const LEAD = String.raw`(?:\s+(?:me|us))?(?:\s+(?:an?|the|some|one))?`
const LINK = String.raw`(?:\s+(?:of|showing|with|depicting|for|about|that shows))?`

const PATTERNS: RegExp[] = [
  // Verbs that only make sense for images: "draw a dragon", "paint me a lake".
  new RegExp(String.raw`^${POLITE}(?:draw|paint|sketch|illustrate|render|imagine)${LEAD}(?:\s+${NOUN})?${LINK}\s+(.+)`, 'i'),
  // General verbs need an image noun: "generate an image of…", "make a logo for…".
  new RegExp(String.raw`^${POLITE}(?:generate|create|make|design|produce|build|craft)${LEAD}(?:\s+\w+)?\s+${NOUN}${LINK}\s+(.+)`, 'i'),
  // "generate a cat in space", but not "generate a summary/list/code…".
  new RegExp(String.raw`^${POLITE}generate${LEAD}\s+(?!(?:\w+\s+)?(?:summary|list|plan|code|script|email|report|story|essay|text|response|answer|idea|ideas|name|names|title|table|poem|question|questions|outline|description|password|number|json|sql|regex|function|test|tests)\b)(.+)`, 'i'),
  // Noun-led: "image of a red car", "an image of…".
  new RegExp(String.raw`^${POLITE}(?:an?\s+)?${NOUN}\s+(?:of|showing|depicting)\s+(.+)`, 'i')
]

export function detectImageGenRequest(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('/imagine ')) return trimmed.slice('/imagine '.length).trim() || null
  for (const pattern of PATTERNS) {
    const prompt = trimmed.match(pattern)?.[1]?.replace(/[.!?]+$/, '').trim()
    if (prompt && prompt.length > 1) return prompt
  }
  return null
}

const SIZE = 768
// Keyless images carry a watermark in the bottom corner; render taller and crop it off.
const WATERMARK_STRIP = 64

/** Same seed + a revised prompt keeps the composition, which is how edits stay close to the original. */
export async function generateImage(prompt: string, fetchFn: FetchFn, seed = Math.floor(Math.random() * 1e6)): Promise<{ dataUrl: string; seed: number }> {
  // gen.pollinations.ai requires an API key for uncached prompts; this endpoint is still keyless.
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${SIZE}&height=${SIZE + WATERMARK_STRIP}&nologo=true&seed=${seed}`
  let res = await fetchFn(url)
  // Pollinations sometimes answers 5xx/429 under load; a short retry almost always succeeds.
  for (let attempt = 1; attempt <= 2 && (res.status >= 500 || res.status === 429); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    res = await fetchFn(url)
  }
  if (!res.ok) throw new Error(`Pollinations returned ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error(`Pollinations returned ${type || 'no content type'} instead of an image`)

  const image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
  const { width, height } = image.getSize()
  if (image.isEmpty() || width === 0) throw new Error('Pollinations returned an unreadable image')
  const cropped = image.crop({ x: 0, y: 0, width, height: Math.max(1, height - Math.round((WATERMARK_STRIP * height) / (SIZE + WATERMARK_STRIP))) })
  return { dataUrl: `data:image/jpeg;base64,${cropped.toJPEG(92).toString('base64')}`, seed }
}

const REWRITE_INSTRUCTIONS =
  'You revise prompts for an image generator. Given the original prompt and a requested edit, write one prompt that describes the edited image. ' +
  'Keep every detail of the original that the edit does not change (subject, pose, framing, background, lighting, style) so the result stays close to the original, ' +
  'and apply the edit precisely. Positions such as "top left" refer to areas of the image. Stay under 70 words. Reply with only the prompt.'

/** Merges an edit into the original prompt with Groq; falls back to plain concatenation if Groq can't be reached. */
export async function rewriteImagePrompt(prompt: string, instruction: string, apiKeys: string[], fetchFn: FetchFn): Promise<string> {
  const fallback = prompt ? `${prompt}, ${instruction}` : instruction
  for (const key of apiKeys) {
    try {
      const res = await fetchFn(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          reasoning_effort: 'low',
          max_completion_tokens: 1024,
          messages: [
            { role: 'system', content: REWRITE_INSTRUCTIONS },
            { role: 'user', content: `Original prompt: ${prompt || '(none)'}\nRequested edit: ${instruction}` }
          ]
        }),
        signal: AbortSignal.timeout(20_000)
      })
      if (res.status === 401 || res.status === 429) continue
      if (!res.ok) return fallback
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const text = json.choices?.[0]?.message?.content?.trim().replace(/^["'`]+|["'`]+$/g, '')
      return text && text.length <= 1200 ? text : fallback
    } catch {
      return fallback
    }
  }
  return fallback
}
