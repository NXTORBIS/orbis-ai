export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const GENERATION_KEYWORDS = [
  'generate image',
  'create image',
  'draw',
  'paint',
  'create a picture',
  'make an image',
  'generate a picture',
  'show me',
  'visualize',
  'imagine',
  'illustrate'
]

export function detectImageGenRequest(text: string): string | null {
  const lower = text.toLowerCase().trim()

  // Check if message contains image generation keywords
  for (const keyword of GENERATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      // Extract the prompt by removing the keyword
      for (const kw of GENERATION_KEYWORDS) {
        const idx = lower.indexOf(kw)
        if (idx !== -1) {
          let prompt = text.substring(idx + kw.length).trim()
          // Remove common punctuation at start
          prompt = prompt.replace(/^[,.:!?-]+\s*/, '').trim()
          if (prompt.length > 3) {
            return prompt
          }
        }
      }
      // If no good prompt found but keyword exists, use whole message
      return text
    }
  }

  return null
}

export async function generateImage(prompt: string, fetchFn: FetchFn): Promise<string> {
  // Encode prompt for URL
  const encoded = encodeURIComponent(prompt)
  const url = `https://gen.pollinations.ai/image/${encoded}?model=dreamshaper`

  try {
    const res = await fetchFn(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    // Get the blob and convert to data URL
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return `data:image/png;base64,${base64}`
  } catch (err) {
    throw new Error(`Image generation failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
