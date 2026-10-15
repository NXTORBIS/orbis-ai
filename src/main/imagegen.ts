import { GROQ_BASE_URL } from './nim.ts'
import { MAX_BATCH, sharedEngine, type GenerateManyResult } from './fastsd/engine.ts'

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const POLITE = String.raw`(?:(?:hey|ok|okay)[,\s]+)?(?:please\s+|pls\s+|can you\s+|could you\s+|would you\s+|will you\s+|i want you to\s+|i'd like you to\s+|i want\s+|i need\s+|give me\s+|show me\s+)?(?:please\s+)?`
const NOUN = String.raw`(?:image|images|picture|pic|photo|photograph|drawing|painting|illustration|artwork|art|wallpaper|logo|icon|poster|sketch|render|portrait|avatar)`
const LEAD = String.raw`(?:\s+(?:me|us))?(?:\s+(?:an?|the|some|one))?`
const LINK = String.raw`(?:\s+(?:of|showing|with|depicting|for|about|that shows))?`

/**
 * Drawn from data or kept as a file, not painted.
 *
 * "Draw a bar chart of sales" asks for numbers plotted, and "generate a spreadsheet of my expenses" asks for a file. A
 * picture generator can only imitate either: it paints something that looks like a chart and means nothing. Those go
 * to the part of Orbis that makes the real thing, so here they are simply not picture requests.
 *
 * Only when the chart is the thing asked for -- at most two describing words before it, and no picture word. "Draw a
 * dragon reading a chart" and "a picture of a chart" are still pictures.
 */
const DATA_DRAWING = String.raw`(?:charts?|graphs?|plots?|histograms?|flow\s?charts?|diagrams?|spreadsheets?)`
const ASKS_FOR_A_DATA_DRAWING = new RegExp(
  String.raw`^${POLITE}(?:draw|paint|sketch|illustrate|render|imagine|generate|create|make|design|produce|build|craft)${LEAD}(?:\s+(?!${NOUN}\b)[\w-]+){0,2}?\s+${DATA_DRAWING}\b`,
  'i'
)
/** Things that are written or kept as files: "generate a ..." one of these is never a picture. */
const WRITTEN = String.raw`summary|list|plan|code|script|email|report|story|essay|text|response|answer|idea|ideas|name|names|title|table|poem|question|questions|outline|description|password|number|json|sql|regex|function|test|tests|spreadsheet|document|doc|file|pdf|csv|excel|word|presentation|slides|deck|invoice|resume|letter|memo|budget|schedule|checklist|template|agenda|itinerary|proposal|contract|readme|program|query|quiz|worksheet`

const PATTERNS: RegExp[] = [
  // Verbs that only make sense for images: "draw a dragon", "paint me a lake".
  new RegExp(String.raw`^${POLITE}(?:draw|paint|sketch|illustrate|render|imagine)${LEAD}(?:\s+${NOUN})?${LINK}\s+(.+)`, 'i'),
  // General verbs need an image noun: "generate an image of…", "make a logo for…".
  new RegExp(String.raw`^${POLITE}(?:generate|create|make|design|produce|build|craft)${LEAD}(?:\s+\w+)?\s+${NOUN}${LINK}\s+(.+)`, 'i'),
  // "generate a cat in space", but not "generate a summary/list/code…".
  new RegExp(String.raw`^${POLITE}generate${LEAD}\s+(?!(?:\w+\s+)?(?:${WRITTEN})\b)(.+)`, 'i'),
  // Noun-led: "image of a red car", "an image of…".
  new RegExp(String.raw`^${POLITE}(?:an?\s+)?${NOUN}\s+(?:of|showing|depicting)\s+(.+)`, 'i')
]

export function detectImageGenRequest(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('/imagine ')) return trimmed.slice('/imagine '.length).trim() || null
  if (ASKS_FOR_A_DATA_DRAWING.test(trimmed)) return null
  for (const pattern of PATTERNS) {
    const prompt = trimmed.match(pattern)?.[1]?.replace(/[.!?]+$/, '').trim()
    if (prompt && prompt.length > 1) return prompt
  }
  return null
}

const COUNT_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2 }
const COUNTED_NOUN = String.raw`(?:images|pictures|pics|photos|photographs|drawings|paintings|illustrations|artworks|variations|versions|options|renders|renderings|logos|posters|wallpapers|portraits|avatars|icons|sketches|designs)`
const COUNTED = new RegExp(String.raw`\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[\w-]+\s+){0,2}?${COUNTED_NOUN}\b`, 'i')

/**
 * How many pictures a message asks for in words ("3 images of a dog", "give me four variations").
 *
 * `requested` is what was asked; `count` is what will be made (at most MAX_BATCH). A number that comes after "of",
 * "showing" or "with" belongs to the picture, not to the request ("a picture of two images on a wall" is one picture).
 */
export function detectImageCount(text: string): { count: number; requested: number } {
  const m = COUNTED.exec(text)
  if (!m) return { count: 1, requested: 1 }
  if (/\b(?:of|showing|with|depicting|containing|where|that)\b/i.test(text.slice(0, m.index))) return { count: 1, requested: 1 }
  const word = m[1].toLowerCase()
  const requested = /^\d/.test(word) ? Number(word) : COUNT_WORDS[word] ?? 1
  if (!Number.isFinite(requested) || requested < 2) return { count: 1, requested: 1 }
  return { count: Math.min(MAX_BATCH, requested), requested }
}

export interface DrawOptions {
  signal?: AbortSignal
  onStatus?: (message: string) => void
  /** The picture being edited (data URL, JPEG or PNG). Without one the picture is made from the words alone. */
  initImage?: string
  strength?: number
}

/**
 * A picture, from a prompt, made on this computer by FastSDCPU (src/main/fastsd/engine.ts). Nothing is sent to an
 * online image service, and there is no fallback to one: when the engine cannot make the picture the error says why.
 */
export async function generateImage(
  prompt: string,
  seed?: number,
  opts: DrawOptions = {}
): Promise<{ dataUrl: string; seed: number; seconds: number; imageToImage: boolean }> {
  const r = await sharedEngine().generate(prompt, { seed, signal: opts.signal, onStatus: opts.onStatus, initImage: opts.initImage, strength: opts.strength })
  return { dataUrl: r.dataUrl, seed: r.seed, seconds: r.seconds.generation, imageToImage: opts.initImage !== undefined }
}

/** Up to MAX_BATCH pictures of one prompt, in order. Failures are returned beside the pictures that did get made. */
export async function generateImages(prompt: string, count: number, seed: number | undefined, opts: DrawOptions = {}): Promise<GenerateManyResult> {
  return sharedEngine().generateMany(prompt, count, { seed, signal: opts.signal, onStatus: opts.onStatus })
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
